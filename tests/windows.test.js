'use strict';
// Windows support (Phase 1: helper, setup, doctor, CLI, keyring; no side-panel runs), tested on any system:
// the Windows code paths run with platform 'win32' passed in and fakes for what only Windows has (reg.exe,
// PowerShell, named pipes: Unix sockets in a folder, TRIF_PIPE_DIR). On a real Windows computer the same
// tests run against real named pipes; reg.exe and PowerShell stay fakes, so nothing of the computer's is
// touched (tests/windows-smoke.js, run by .github/workflows/windows.yml, does the real thing on CI).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { tempDir, FakeExtension, waitFor, CLI_JS } = require('./fake-extension');
const { makeFakePowerShell, makeFakeReg } = require('./fake-powershell');
const P = require('../helper/lib/paths');
const B = require('../helper/lib/browsers');
const launchers = require('../helper/lib/win/launchers');
const registry = require('../helper/lib/win/registry');
const ps = require('../helper/lib/win/powershell');
const credman = require('../helper/lib/win/credman');
const userpath = require('../helper/lib/win/userpath');
const pipes = require('../helper/lib/win/pipes');
const winSetup = require('../helper/lib/win/setup');
const platform = require('../helper/lib/platform');
const pathcheck = require('../helper/lib/pathcheck');
const keyring = require('../helper/lib/keyring');
const { findExecutable } = require('../helper/lib/agents/util');
const { Runs } = require('../helper/lib/runs');
const { Logins } = require('../helper/lib/logins');

const IS_WIN = process.platform === 'win32';
const FAKE_KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef';

// Pipes for this test run: Unix sockets in a short folder (socket paths are limited to ~104 bytes) on
// macOS and Linux; real named pipes on Windows (TRIF_PIPE_DIR is ignored there).
function pipeEnv() {
  if (IS_WIN) return {};
  const dir = fs.realpathSync(fs.mkdtempSync('/tmp/tp-'));
  return { TRIF_PIPE_DIR: dir };
}

// ------------------------------------------------------------------ paths and browsers

test('windows paths: the private folder in %LOCALAPPDATA%\\TRIF; wrappers .bat/.cmd/sh; no pre-0.2.0 names', () => {
  const homedir = path.join(path.sep, 'Users', 'tim');
  assert.equal(P.defaultPrivateDir({ platform: 'win32', homedir, env: { LOCALAPPDATA: path.join(homedir, 'L') } }), path.join(homedir, 'L', 'TRIF'));
  // Not set (or not absolute): where Windows keeps it.
  assert.equal(P.defaultPrivateDir({ platform: 'win32', homedir, env: {} }), path.join(homedir, 'AppData', 'Local', 'TRIF'));
  assert.equal(P.defaultPrivateDir({ platform: 'win32', homedir, env: { LOCALAPPDATA: 'relative' } }), path.join(homedir, 'AppData', 'Local', 'TRIF'));
  // macOS and Linux unchanged.
  assert.equal(P.defaultPrivateDir({ platform: 'darwin', homedir, env: {} }), path.join(homedir, 'Library', 'Application Support', 'TRIF'));
  assert.equal(P.defaultPrivateDir({ platform: 'linux', homedir, env: {} }), path.join(homedir, '.local', 'state', 'trif'));

  const home = tempDir('wn-');
  const w = P.workspace(home, { platform: 'win32' });
  assert.equal(w.hostWrapper, path.join(home, 'bin', 'trif-host.bat'));
  assert.equal(w.cliWrapper, path.join(home, 'bin', 'trif.cmd'));
  assert.equal(w.cliShWrapper, path.join(home, 'bin', 'trif'));
  assert.equal(w.legacyHostWrapper, null);
  assert.equal(w.legacyCliWrapper, null);
  // The CLI's default helper: what helper.pipe names, or a pipe nobody listens on.
  assert.equal(w.sock, pipes.nobodyName({ platform: 'win32' }));
  const m = P.workspace(home, { platform: 'darwin' });
  assert.equal(m.sock, path.join(home, 'helper.sock'));
  assert.equal(m.hostWrapper, path.join(home, 'bin', 'trif-host'));
  assert.equal(m.legacyCliWrapper, path.join(home, 'bin', 'webmods'));
  assert.ok(P.sameName('C:\\Users\\Tim\\.trif', 'c:\\users\\tim\\.TRIF', 'win32'));
  assert.ok(!P.sameName('/Users/Tim/.trif', '/users/tim/.trif', 'darwin'));
});

test('windows browsers: user data folders under %LOCALAPPDATA%/%APPDATA%, manifests in TRIF\'s, registry keys per browser', () => {
  const homedir = tempDir('wb-');
  const env = { LOCALAPPDATA: path.join(homedir, 'L'), APPDATA: path.join(homedir, 'R') };
  fs.mkdirSync(path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data'), { recursive: true });
  fs.mkdirSync(path.join(env.APPDATA, 'Mozilla', 'Firefox'), { recursive: true });
  const t = B.browserTable(homedir, 'win32', env);
  assert.deepEqual(t.map((b) => b.key), ['chrome', 'chromium', 'brave', 'edge', 'firefox']);
  assert.deepEqual(t.filter((b) => b.detected).map((b) => b.key), ['chrome', 'firefox']);
  const chrome = t.find((b) => b.key === 'chrome');
  assert.equal(chrome.nativeDir, path.join(env.LOCALAPPDATA, 'TRIF', 'NativeMessagingHosts', 'chrome'));
  assert.ok(t.find((b) => b.key === 'firefox').firefox);
  assert.ok(!t.some((b) => b.safari), 'no Safari on Windows');
  assert.deepEqual(B.nativeRegKeys(chrome, { env: {} }), ['HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.webmods.helper']);
  assert.deepEqual(B.nativeRegKeys(t.find((b) => b.key === 'firefox'), { env: {} }), ['HKCU\\Software\\Mozilla\\NativeMessagingHosts\\com.webmods.helper']);
  assert.deepEqual(B.nativeRegKeys(t.find((b) => b.key === 'edge'), { env: {} }), ['HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.webmods.helper']);
  assert.equal(B.nativeRegKeys(t.find((b) => b.key === 'brave'), { env: {} }).length, 2, 'Brave: its own key and Chrome\'s');
  // Tests on a real Windows computer use a scratch root instead of HKCU\Software.
  assert.deepEqual(B.nativeRegKeys(chrome, { env: { TRIF_REG_ROOT: 'HKCU\\Software\\TRIF-test-1' } }), ['HKCU\\Software\\TRIF-test-1\\Google\\Chrome\\NativeMessagingHosts\\com.webmods.helper']);
  assert.deepEqual(B.nativeRegKeys(chrome, { env: { TRIF_REG_ROOT: 'HKLM\\Software\\x' } }), ['HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.webmods.helper'], 'only a key under HKCU\\Software');
  assert.deepEqual(B.selectBrowsers('firefox', homedir, 'win32', env).map((b) => b.key), ['firefox']);
  assert.throws(() => B.selectBrowsers('safari', homedir, 'win32', env), /unknown browser "safari"/);
  // macOS unchanged.
  assert.ok(B.browserTable(homedir, 'darwin').some((b) => b.safari));
});

// ------------------------------------------------------------------ wrappers

test('windows wrappers: @echo off first, CRLF, paths quoted with % doubled; a sh one for Git Bash; doctor reads them back', () => {
  const node = 'C:\\Program Files\\nodejs\\node.exe';
  const host = 'C:\\Users\\Tim 100%\\.trif\\app\\helper\\host.js';
  const bat = launchers.hostBatContent(node, host, null);
  assert.ok(bat.startsWith('@echo off\r\n'), 'nothing cmd.exe prints may reach the native messaging stream');
  assert.ok(!/[^\r]\n/.test(bat), 'CRLF only');
  assert.equal(bat, '@echo off\r\n"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\Tim 100%%\\.trif\\app\\helper\\host.js" %*\r\n');
  assert.deepEqual(launchers.parseLauncher(bat), { node, script: host, home: null });
  const elsewhere = launchers.hostBatContent(node, host, 'D:\\work\\trif');
  assert.match(elsewhere, /^@echo off\r\nset "TRIF_HOME=D:\\work\\trif"\r\n/);
  assert.deepEqual(launchers.parseLauncher(elsewhere), { node, script: host, home: 'D:\\work\\trif' });
  const cmd = launchers.cliCmdContent(node, 'C:\\a\\cli.js', 'D:\\w');
  assert.equal(cmd, '@echo off\r\nsetlocal\r\nif not defined TRIF_HOME set "TRIF_HOME=D:\\w"\r\n"C:\\Program Files\\nodejs\\node.exe" "C:\\a\\cli.js" %*\r\n');
  assert.equal(launchers.parseLauncher(cmd).home, 'D:\\w');
  assert.throws(() => launchers.batQuote('C:\\a"b'), /can't put/);
  assert.throws(() => launchers.batQuote('C:\\a\nb'), /can't put/);
  const sh = launchers.cliShContent(node, 'C:\\a\\cli.js', null);
  assert.equal(sh, '#!/bin/sh\nexec "C:/Program Files/nodejs/node.exe" "C:/a/cli.js" "$@"\n');
  assert.match(launchers.cliShContent(node, 'C:\\a\\cli.js', 'D:\\w $x'), /: "\$\{TRIF_HOME:=D:\/w \\\$x\}"/);
  assert.equal(launchers.parseLauncher('#!/bin/sh\nexec node x\n'), null);
});

// ------------------------------------------------------------------ registry

test('windows registry: reg.exe add/query/delete of a key\'s default value; System32\'s reg.exe; any language', () => {
  const fake = makeFakeReg();
  const opts = { env: { SystemRoot: 'C:\\Windows' }, run: fake.run };
  const key = registry.fullKey('Google\\Chrome\\NativeMessagingHosts\\com.webmods.helper', opts);
  assert.equal(registry.getDefault(key, opts).value, null);
  assert.equal(registry.setDefault(key, 'C:\\Users\\Tim\\AppData\\Local\\TRIF\\NativeMessagingHosts\\chrome\\com.webmods.helper.json', opts), null);
  assert.deepEqual(fake.calls[1], { file: 'C:\\Windows\\System32\\reg.exe', args: ['add', key, '/ve', '/t', 'REG_SZ', '/d', 'C:\\Users\\Tim\\AppData\\Local\\TRIF\\NativeMessagingHosts\\chrome\\com.webmods.helper.json', '/f'] });
  assert.equal(registry.getDefault(key, opts).value, 'C:\\Users\\Tim\\AppData\\Local\\TRIF\\NativeMessagingHosts\\chrome\\com.webmods.helper.json');
  assert.equal(registry.deleteKey(key, opts), null);
  assert.match(registry.deleteKey(key, opts), /unable to find/);
  // "(Default)" is translated ("(Standard)" in German): matched by the type instead.
  const de = makeFakeReg({ label: '(Standard)' });
  registry.setDefault('HKCU\\Software\\X', 'C:\\a b\\c.json', { run: de.run });
  assert.equal(registry.getDefault('HKCU\\Software\\X', { run: de.run }).value, 'C:\\a b\\c.json');
  // A reg.exe that can't start.
  assert.match(registry.setDefault('HKCU\\Software\\X', 'v', { run: () => ({ error: new Error('spawn ENOENT') }) }), /ENOENT/);
});

test('windows setup steps: each browser\'s key points at its manifest; Brave takes Chrome\'s only when free; doctor checks them', () => {
  const homedir = tempDir('wr-');
  const env = { LOCALAPPDATA: path.join(homedir, 'L'), APPDATA: path.join(homedir, 'R') };
  const t = B.browserTable(homedir, 'win32', env);
  const fake = makeFakeReg();
  const opts = { env: {}, run: fake.run };
  const manifest = (b) => { fs.mkdirSync(b.nativeDir, { recursive: true }); const f = path.join(b.nativeDir, 'com.webmods.helper.json'); fs.writeFileSync(f, '{}'); return f; };
  const chrome = t.find((b) => b.key === 'chrome');
  const brave = t.find((b) => b.key === 'brave');
  const cf = manifest(chrome);
  assert.match(winSetup.checkNativeHost(chrome, cf, opts), /registry key .* is missing/);
  assert.deepEqual(winSetup.registerNativeHost(chrome, cf, opts), { keys: [B.nativeRegKeys(chrome, opts)[0]], error: null });
  assert.equal(winSetup.checkNativeHost(chrome, cf, opts), null);
  const bf = manifest(brave);
  const r = winSetup.registerNativeHost(brave, bf, opts);
  assert.deepEqual(r.keys, [B.nativeRegKeys(brave, opts)[0]], 'Chrome\'s key already names a TRIF manifest: left alone');
  assert.equal(winSetup.checkNativeHost(chrome, cf, opts), null);
  assert.equal(winSetup.checkNativeHost(brave, bf, opts), null);
  // Something else in Chrome's key: Brave takes it; Chrome's check then says so.
  fake.keys.set(B.nativeRegKeys(chrome, opts)[0].toLowerCase(), 'C:\\other\\host.json');
  assert.equal(winSetup.registerNativeHost(brave, bf, opts).keys.length, 2);
  assert.match(winSetup.checkNativeHost(chrome, cf, opts), /points at .*brave/);
  const failing = { env: {}, run: () => ({ status: 1, stdout: '', stderr: 'ERROR: Access is denied.\r\n' }) };
  assert.match(winSetup.registerNativeHost(chrome, cf, failing).error, /couldn't write the registry key .*Access is denied/);
});

// ------------------------------------------------------------------ PowerShell, Credential Manager, PATH

test('windows PowerShell: System32\'s Windows PowerShell, no profile, the script encoded; a .js stand-in runs with node', () => {
  const b = ps.powershellBin({ env: { SystemRoot: 'D:\\Win' } });
  assert.deepEqual(b, { file: 'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', prefix: [] });
  assert.deepEqual(ps.powershellBin({ env: { TRIF_POWERSHELL_BIN: '/x/fake.js' } }), { file: process.execPath, prefix: ['/x/fake.js'] });
  const args = ps.psArgs('Write-Output "hi"');
  assert.deepEqual(args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand']);
  assert.equal(Buffer.from(args[4], 'base64').toString('utf16le'), 'Write-Output "hi"');
  assert.equal(ps.psComplaint({ code: 1, stderr: 'Access is denied.\r\nAt line:1 char:5\r\n+ CategoryInfo : x\r\n' }), 'Access is denied.');
  // The scripts take what varies on stdin: nothing to interpolate into them.
  for (const s of [credman.SCRIPT, userpath.SCRIPT]) assert.match(s, /\[Console\]::In\.ReadLine\(\)/);
  assert.ok(ps.psArgs(credman.SCRIPT).join(' ').length < 30000, 'well under Windows\' 32767-character command line');
});

test('windows keyring: Credential Manager through PowerShell, the key on stdin/stdout as hex, never in argv', async (t) => {
  const fake = makeFakePowerShell(path.join(tempDir('wk-'), 'ps'));
  const o = { env: { TRIF_KEYCHAIN_BIN: fake.bin }, platform: 'darwin' }; // (forced: works on every system)
  assert.deepEqual(keyring.backend(o), { kind: 'credman', bin: fake.bin, name: 'Windows Credential Manager' });
  assert.deepEqual(keyring.backend({ env: {}, platform: 'win32' }), { kind: 'credman', bin: null, name: 'Windows Credential Manager' });
  assert.deepEqual(await keyring.getKey('openrouter', o), { value: null, error: null });
  assert.deepEqual(await keyring.hasKey('openrouter', o), { stored: false, error: null });
  await keyring.setKey('openrouter', `  ${FAKE_KEY}\n`, o);
  assert.deepEqual(fake.creds(), { 'TRIF open model key/openrouter': { user: 'openrouter', hex: Buffer.from(FAKE_KEY).toString('hex') } });
  assert.deepEqual(await keyring.getKey('openrouter', o), { value: FAKE_KEY, error: null });
  assert.deepEqual(await keyring.hasKey('openrouter', o), { stored: true, error: null });
  // Another service (agentkeys.js), another credential.
  await keyring.setKey('anthropic', FAKE_KEY.replace('or', 'an'), { ...o, service: 'TRIF API key' });
  assert.ok('TRIF API key/anthropic' in fake.creds());
  assert.deepEqual(await keyring.removeKey('openrouter', o), { removed: true });
  assert.deepEqual(await keyring.removeKey('openrouter', o), { removed: false });
  const argv = fake.argvText();
  assert.ok(!argv.includes(FAKE_KEY) && !argv.includes(Buffer.from(FAKE_KEY).toString('hex')), 'the key is never in a command line');
  // Checked before anything runs; too long for a generic credential.
  await assert.rejects(keyring.setKey('openrouter', 'has spaces in it', o), /doesn't look like an API key/);
  await assert.rejects(keyring.setKey('openrouter', 'k'.repeat(3000), o), /too long for Windows Credential Manager/);
  // A failure says why, without the key.
  fake.fail(`CredWrite failed for ${FAKE_KEY}`);
  await assert.rejects(keyring.setKey('openrouter', FAKE_KEY, o), (e) => /couldn't save the key in Windows Credential Manager: CredWrite failed for \[redacted\]/.test(e.message));
  const g = await keyring.getKey('openrouter', o);
  assert.equal(g.value, null);
  assert.match(g.error, /couldn't read the key from Windows Credential Manager/);
  fake.fail(null);
  assert.match(keyring.noKeyring({ platform: 'freebsd' }), /Windows Credential Manager/);
});

test('windows PATH: <home>\\bin added to the user\'s PATH once; --no-link leaves it; a failure says how to do it by hand', () => {
  const fake = makeFakePowerShell(path.join(tempDir('wp-'), 'ps'));
  fake.setUserPath('C:\\Windows\\stuff;%USERPROFILE%\\tools;');
  const ws = { bin: 'C:\\Users\\Tim\\.trif\\bin' };
  const add = (dir, o = {}) => userpath.addToUserPath(dir, { ...o, bin: fake.bin });
  assert.deepEqual(add(ws.bin, { check: true }), { how: 'missing', error: null });
  let lines = winSetup.userPathStep(ws, { pathEnv: 'C:\\Windows', add });
  assert.deepEqual(lines, ['PATH          added C:\\Users\\Tim\\.trif\\bin to your PATH (open a new terminal to use trif)']);
  assert.equal(fake.userPath(), 'C:\\Windows\\stuff;%USERPROFILE%\\tools;C:\\Users\\Tim\\.trif\\bin', 'kept as written, the folder at the end');
  lines = winSetup.userPathStep(ws, { pathEnv: 'C:\\Windows', add });
  assert.deepEqual(lines, ['PATH          C:\\Users\\Tim\\.trif\\bin is on your PATH (open a new terminal to use trif)']);
  assert.deepEqual(winSetup.userPathStep(ws, { pathEnv: 'C:\\Windows;c:\\users\\tim\\.TRIF\\bin\\', add }), [], 'already in this terminal\'s PATH: nothing to say');
  assert.equal(fake.userPath().split(';').length, 3, 'added once');
  assert.match(winSetup.userPathStep(ws, { noLink: true, pathEnv: 'C:\\Windows', add }).join('\n'), /left alone: --no-link/);
  fake.fail('Requested registry access is not allowed.');
  assert.match(winSetup.userPathStep(ws, { pathEnv: 'C:\\Windows', add }).join('\n'), /couldn't add .* to your PATH: Requested registry access is not allowed\.\n.*Environment Variables/);
});

// ------------------------------------------------------------------ setup and doctor, Windows' way

test('windows setup: wrappers, manifests + registry keys, PATH, no /usr/local/bin link; doctor agrees, then spots a broken key', async () => {
  const root = tempDir('ws-');
  const home = path.join(root, 'trif');
  const homedir = path.join(root, 'profile');
  const env = { LOCALAPPDATA: path.join(homedir, 'AppData', 'Local'), APPDATA: path.join(homedir, 'AppData', 'Roaming') };
  fs.mkdirSync(path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data'), { recursive: true });
  const reg = makeFakeReg();
  const regOpts = { env: {}, run: reg.run };
  const added = [];
  const { setup } = require('../helper/lib/setup');
  const r = setup({
    home, platform: 'win32', homedir, env, regOpts, mode: 'link', noExamples: true, browser: 'chrome,firefox',
    addToUserPath: (dir) => { added.push(dir); return { how: 'added', error: null }; },
  });
  const text = r.lines.join('\n');
  assert.ok(r.ok, text);
  const ws = P.workspace(home, { platform: 'win32' });
  const bat = fs.readFileSync(ws.hostWrapper, 'utf8');
  assert.deepEqual(launchers.parseLauncher(bat), { node: r.nodePath, script: path.join(P.REPO_ROOT, 'helper', 'host.js'), home });
  assert.equal(launchers.parseLauncher(fs.readFileSync(ws.cliWrapper, 'utf8')).script, path.join(P.REPO_ROOT, 'helper', 'cli.js'));
  assert.match(fs.readFileSync(ws.cliShWrapper, 'utf8'), /^#!\/bin\/sh\n/);
  for (const old of ['webmods', 'webmods-host', 'trif-host']) assert.ok(!fs.existsSync(path.join(ws.bin, old)), `no ${old} on Windows`);
  // One manifest per browser in %LOCALAPPDATA%\TRIF, each browser's key naming it.
  for (const key of ['chrome', 'firefox']) {
    const b = B.browserTable(homedir, 'win32', env).find((x) => x.key === key);
    const file = path.join(b.nativeDir, 'com.webmods.helper.json');
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(m.path, ws.hostWrapper);
    assert.equal(m.type, 'stdio');
    if (key === 'firefox') assert.deepEqual(m.allowed_extensions, [P.FIREFOX_EXTENSION_ID]);
    else assert.ok(m.allowed_origins.includes(P.EXTENSION_ORIGIN));
    assert.equal(reg.get(B.nativeRegKeys(b, regOpts)[0]), file);
    assert.ok(r.manifests.some((x) => x.file === file));
  }
  assert.match(text, /registered: HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com\.webmods\.helper/);
  assert.deepEqual(added, [ws.bin]);
  assert.match(text, /PATH {10}added .* to your PATH/);
  assert.ok(!/CLI link|sudo ln|zshrc|Finder|Cmd-Shift-G/.test(text), text);
  assert.ok(!fs.existsSync(path.join(homedir, 'Library')), 'nothing of macOS\'s');

  const { doctor } = require('../helper/lib/doctor');
  let d = await doctor({ home, platform: 'win32', homedir, env, regOpts });
  const titles = d.checks.map((c) => `${c.status} ${c.title}`).join('\n');
  assert.match(titles, /^ok host wrapper .*trif-host\.bat -> /m);
  assert.match(titles, /^ok Google Chrome: native host manifest$/m);
  assert.match(titles, /^ok Firefox: native host manifest$/m);
  assert.match(titles, /^fail helper isn't running \(no .*helper\.pipe\)$/m);
  assert.match(titles, /^info Chats from the panel aren’t available on Windows yet: use your coding agent in a terminal, in /m);
  // The key gone (a registry cleaner, another program): doctor says which, and setup is the fix.
  reg.keys.delete(B.nativeRegKeys(B.browserTable(homedir, 'win32', env)[0], regOpts)[0].toLowerCase());
  d = await doctor({ home, platform: 'win32', homedir, env, regOpts });
  const chrome = d.checks.find((c) => /^Google Chrome: native host manifest .*registry key .* is missing/.test(c.title));
  assert.ok(chrome, d.checks.map((c) => c.title).join('\n'));
  assert.match(chrome.fix, /setup.* --browser chrome/);

  // Updates (--no-link) leave the user's PATH alone.
  const again = setup({ home, platform: 'win32', homedir, env, regOpts, mode: 'link', noExamples: true, browser: 'chrome', noLink: true, addToUserPath: () => assert.fail('PATH touched') });
  assert.ok(again.ok, again.lines.join('\n'));
});

// ------------------------------------------------------------------ named pipes

test('windows pipes: random names only; markers say where; one primary at a time, a stale one replaced', async (t) => {
  const env = pipeEnv();
  const o = { env };
  const a = pipes.newPipeName(o);
  const b = pipes.newPipeName(o);
  assert.notEqual(a, b);
  assert.ok(pipes.isPipeName(a, o) && pipes.isPipeName(b, o));
  assert.ok(!pipes.isPipeName('\\\\.\\pipe\\something-else', { env: {}, platform: 'win32' }));
  assert.ok(pipes.isPipeName(`\\\\.\\pipe\\trif-${'a'.repeat(32)}`, { env: {}, platform: 'win32' }));
  assert.ok(!pipes.isPipeName(`\\\\.\\pipe\\trif-${'a'.repeat(32)}\\..\\x`, { env: {}, platform: 'win32' }));
  assert.ok(pipes.usesPipes({ platform: 'win32', env: {} }));
  assert.ok(!pipes.usesPipes({ platform: 'darwin', env: {} }));
  assert.equal(pipes.pipeDir({ platform: 'win32', env: { TRIF_PIPE_DIR: '/tmp' } }), null, 'real pipes on Windows, always');

  const home = tempDir('wq-');
  const servers = [];
  t.after(() => { for (const s of servers) s.close(); });
  const serve = (name) => new Promise((resolve) => { const s = net.createServer((c) => c.end()); servers.push(s); s.listen(name, () => resolve(s)); });

  assert.equal(pipes.defaultEndpoint(home, o), pipes.nobodyName(o));
  await serve(a);
  assert.equal(await pipes.claimPrimary(home, a, o), 'primary');
  assert.equal(await pipes.claimPrimary(home, a, o), 'primary', 'already ours');
  assert.equal(pipes.defaultEndpoint(home, o), a);
  assert.equal(await pipes.claimPrimary(home, b, o), 'busy', 'a live helper is the primary');
  // A marker naming something that isn't one of our pipes is never used.
  fs.writeFileSync(pipes.ownMarker(home, 4242), 'C:\\Windows\\System32\\evil\n');
  pipes.writeMarker(pipes.ownMarker(home, 4243), b);
  assert.deepEqual(pipes.listMarkers(home, o).map((m) => [m.pid, m.sock]), [[4243, b]]);
  // The primary goes away (its pipe with it; a crash leaves the marker): the next helper takes over.
  servers[0].close();
  await waitFor(() => pipes.probe(a, 300).then((alive) => !alive), { message: 'pipe a gone' });
  await serve(b);
  assert.equal(await pipes.claimPrimary(home, b, o), 'primary');
  assert.equal(pipes.primaryPipe(home, o), b);
  // A marker being written right now (empty) isn't stale.
  fs.writeFileSync(pipes.primaryMarker(home), '');
  assert.equal(await pipes.claimPrimary(home, a, { ...o, probeFn: async () => false }), 'busy');
  // Release: the primary marker only if it's ours.
  pipes.writeMarker(pipes.primaryMarker(home), b);
  pipes.release(home, a, 4243);
  assert.equal(pipes.primaryPipe(home, o), b, 'not ours: kept');
  assert.ok(!fs.existsSync(pipes.ownMarker(home, 4243)));
  pipes.release(home, b, 4243);
  assert.equal(pipes.primaryPipe(home, o), null);
});

test('windows pipes: real helpers; the CLI finds the primary through helper.pipe, --browser through the markers; takeover; doctor', { timeout: 60000 }, async (t) => {
  const home = tempDir('wh-');
  const env = { ...pipeEnv(), TRIF_PRIVATE: path.join(tempDir('whp-'), 'private') };
  const first = new FakeExtension({ home, env });
  t.after(() => first.close());
  first.hello({ browser: 'Chrome' });
  const marker = pipes.primaryMarker(home);
  await waitFor(() => pipes.readMarker(marker, { env }), { timeout: 10000, message: 'helper.pipe' });
  const pipe1 = pipes.readMarker(marker, { env });
  assert.equal(pipes.readMarker(pipes.ownMarker(home, first.child.pid), { env }), pipe1, 'the primary serves the CLI on its own pipe');
  if (!IS_WIN) assert.ok(!fs.existsSync(path.join(home, 'helper.sock')), 'no Unix socket in the workspace');

  const cli = (args) => new Promise((resolve) => {
    require('child_process').execFile(process.execPath, [CLI_JS, ...args], { env: { ...process.env, TRIF_HOME: home, TRIF_UPDATE_DELAY: '2000000000', ...env }, timeout: 20000 },
      (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout, stderr }));
  });
  let r = await cli(['status', '--json']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).helper.pid, first.child.pid);

  const second = new FakeExtension({ home, env });
  t.after(() => second.close());
  second.hello({ browser: 'Firefox' });
  await waitFor(() => pipes.readMarker(pipes.ownMarker(home, second.child.pid), { env }), { timeout: 10000, message: 'second marker' });
  assert.equal(pipes.readMarker(marker, { env }), pipe1, 'the first stays the primary');
  r = await cli(['status', '--browser', 'firefox', '--json']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).helper.pid, second.child.pid);

  // The browser closes the first: its markers go, the second takes over.
  await first.close();
  assert.ok(!fs.existsSync(pipes.ownMarker(home, first.child.pid)));
  await waitFor(() => pipes.readMarker(marker, { env }) === pipes.readMarker(pipes.ownMarker(home, second.child.pid), { env }), { timeout: 10000, message: 'takeover' });
  r = await cli(['status', '--json']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).helper.pid, second.child.pid);

  // Nobody left: the CLI's usual "helper isn't running" (exit 2).
  await second.close();
  assert.ok(!fs.existsSync(marker), 'the last helper removes helper.pipe');
  r = await cli(['status']);
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /helper isn't running/);
});

// ------------------------------------------------------------------ path checks

test('windows path checks: backslashes, drive letters and names in any case, \\\\?\\ paths; dot/space endings, streams and devices are outside', () => {
  const W = { ci: true, sep: '\\' };
  assert.ok(pathcheck.within('c:\\users\\tim\\.trif\\sites\\x.com\\a.js', 'C:\\Users\\Tim\\.trif\\sites', W));
  assert.ok(!pathcheck.within('C:\\Users\\Tim\\.trif\\sites2\\a.js', 'C:\\Users\\Tim\\.trif\\sites', W), 'a separator boundary');
  assert.ok(!pathcheck.within('D:\\Users\\Tim\\.trif\\sites\\a.js', 'C:\\Users\\Tim\\.trif\\sites', W), 'another drive');
  assert.ok(pathcheck.within('\\\\?\\C:\\Users\\Tim\\.trif\\sites\\a.js', 'C:\\Users\\Tim\\.trif\\sites', W));
  assert.ok(pathcheck.within('\\\\?\\UNC\\srv\\share\\trif\\sites\\a.js', '\\\\srv\\share\\trif\\sites', W));
  assert.ok(pathcheck.within('C:\\Users\\Tim\\.trif\\sites', 'c:\\users\\tim\\.trif\\SITES', { ...W, orEqual: true }));
  for (const odd of ['C:\\t\\sites\\.. .\\config.json', 'C:\\t\\sites\\x.com.\\a.js', 'C:\\t\\sites\\x.com\\a.js ', 'C:\\t\\sites\\a.js:hidden',
    'C:\\t\\sites\\x.com\\NUL', 'C:\\t\\sites\\x.com\\com1.js', 'C:\\t\\sites\\aux.d\\a.js', '\\\\?\\C:\\t\\sites\\x.com\\con']) {
    assert.ok(pathcheck.winOddPath(odd), odd);
  }
  for (const fine of ['C:\\t\\sites\\x.com\\a.js', 'C:\\t\\sites\\..\\sites\\x.com\\a.js', 'C:\\', 'D:\\a\\.trif\\b', 'C:\\t\\console.js', '\\\\srv\\share\\a']) {
    assert.ok(!pathcheck.winOddPath(fine), fine);
  }
  assert.equal(pathcheck.stripLongPrefix('\\\\?\\C:\\a'), 'C:\\a');
  // macOS and Linux paths are unchanged by any of this.
  assert.ok(pathcheck.within('/a/b/c', '/a/b', { sep: '/' }));
});

test('windows path checks for real (Windows only): isInside refuses odd names, ignores case and drive letter case', { skip: !IS_WIN && 'needs Windows\' file system' }, () => {
  const root = tempDir('wpc-');
  fs.mkdirSync(path.join(root, 'sites', 'x.com'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sites', 'x.com', 'a.js'), '');
  const sites = path.join(root, 'sites');
  assert.ok(pathcheck.isInside(path.join(root, 'SITES', 'X.COM', 'a.js'), sites));
  assert.ok(pathcheck.isInside(path.join(root, 'sites', 'x.com', 'new.js'), sites));
  const swapped = root[0] === root[0].toUpperCase() ? root[0].toLowerCase() + root.slice(1) : root[0].toUpperCase() + root.slice(1);
  assert.ok(pathcheck.isInside(path.join(swapped, 'sites', 'x.com', 'a.js'), sites), 'drive letter case');
  assert.ok(!pathcheck.isInside(`${path.join(root, 'sites')}\\.. .\\config.json`, sites));
  assert.ok(!pathcheck.isInside(path.join(root, 'sites', 'x.com', 'a.js:stream'), sites));
  assert.ok(!pathcheck.isInside(path.join(root, 'sites', 'x.com', 'nul'), sites));
  assert.ok(!pathcheck.isInside(path.join(root, 'config.json'), sites));
});

// ------------------------------------------------------------------ processes, programs, no panel runs

test('windows processes: taskkill /T for a tree, rundll32 for URLs, renames retried; macOS/Linux unchanged', () => {
  const calls = [];
  const run = (file, args) => { calls.push([file, ...args]); return { status: 0 }; };
  let killed = 0;
  platform.killTree({ pid: 1234, kill: () => { killed++; } }, 'SIGTERM', { platform: 'win32', run, env: { SystemRoot: 'C:\\Windows' } });
  assert.deepEqual(calls.pop(), ['C:\\Windows\\System32\\taskkill.exe', '/PID', '1234', '/T', '/F']);
  assert.equal(killed, 1);
  platform.killTree({ pid: undefined, kill() {} }, 'SIGTERM', { platform: 'win32', run });
  assert.equal(calls.length, 0, 'nothing started: nothing to kill');
  assert.ok(platform.openUrl('https://timsrobot.com/report#a=1&b=2', { platform: 'win32', run, env: { SystemRoot: 'C:\\Windows' } }));
  assert.deepEqual(calls.pop(), ['C:\\Windows\\System32\\rundll32.exe', 'url.dll,FileProtocolHandler', 'https://timsrobot.com/report#a=1&b=2']);
  assert.ok(platform.openUrl('https://x', { platform: 'darwin', run }));
  assert.deepEqual(calls.pop(), ['open', 'https://x']);
  assert.ok(platform.openUrl('https://x', { platform: 'linux', run }));
  assert.deepEqual(calls.pop(), ['xdg-open', 'https://x']);

  let n = 0;
  const flaky = () => { if (++n < 3) { const e = new Error('busy'); e.code = 'EBUSY'; throw e; } };
  platform.renameRetry('a', 'b', { platform: 'win32', rename: flaky, delayMs: 1 });
  assert.equal(n, 3);
  n = 0;
  assert.throws(() => platform.renameRetry('a', 'b', { platform: 'darwin', rename: flaky }), /busy/, 'no retries elsewhere');
  const missing = () => { const e = new Error('gone'); e.code = 'ENOENT'; throw e; };
  assert.throws(() => platform.renameRetry('a', 'b', { platform: 'win32', rename: missing, delayMs: 1 }), /gone/, 'only "in use" errors are retried');
  assert.equal(platform.nodeExeName('win32'), 'node.exe');
  assert.equal(platform.nodeExeName('darwin'), 'node');
});

test('windows agents: found by extension, a real .exe before an npm .cmd', () => {
  const a = tempDir('wa-');
  const b = tempDir('wa-');
  fs.writeFileSync(path.join(a, 'claude.cmd'), '');
  fs.writeFileSync(path.join(b, 'claude.exe'), '');
  fs.writeFileSync(path.join(b, 'codex.cmd'), '');
  assert.equal(findExecutable('claude', [a], { platform: 'win32' }), path.join(a, 'claude.cmd'));
  assert.equal(findExecutable('claude', [b, a], { platform: 'win32' }), path.join(b, 'claude.exe'));
  fs.writeFileSync(path.join(a, 'claude.exe'), '');
  assert.equal(findExecutable('claude', [a], { platform: 'win32' }), path.join(a, 'claude.exe'), 'in one folder, the .exe');
  assert.equal(findExecutable('codex', [a, b], { platform: 'win32' }), path.join(b, 'codex.cmd'));
  assert.equal(findExecutable('nothing', [a, b], { platform: 'win32' }), null);
});

test('windows: no chats from the panel (runs and logins refused, with what to do instead); other systems unchanged', () => {
  const off = platform.panelRunsOff('win32', 'C:\\Users\\Tim\\.trif');
  assert.equal(off.title, 'Chats from the panel aren’t available on Windows yet');
  assert.match(off.text, /^Use your coding agent in a terminal instead: open one in C:\\Users\\Tim\\.trif and ask it there\./);
  assert.equal(platform.panelRunsOff('darwin'), null);
  assert.equal(platform.panelRunsOff('linux'), null);
  const home = tempDir('wx-');
  const getWorkspace = () => P.workspace(home);
  const runs = new Runs({ getWorkspace, platform: 'win32' });
  assert.throws(() => runs.start({ prompt: 'make it blue', site: 'x.com', url: 'https://x.com/' }), /chats from the panel aren't available on Windows yet: use your coding agent in a terminal, in /);
  assert.deepEqual(runs.list(), []);
  const logins = new Logins({ getWorkspace, platform: 'win32' });
  assert.throws(() => logins.start({ agent: 'claude' }), /aren't available on Windows yet.*\(log in there too\)/);
});

test('windows: the panel shows the helper\'s notice instead of the chat box', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'sidepanel.js'), 'utf8');
  assert.match(src, /const runsOff = view\.agents\?\.runsOff \|\| null;/);
  assert.match(src, /const canSend = !runsOff && /);
  assert.match(src, /view\.agents\.runsOff\.title\), el\('p', null, view\.agents\.runsOff\.text\)/);
});

test('windows: the npm package installs there; checkouts keep LF line endings', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.os.includes('win32'));
  assert.match(fs.readFileSync(path.join(__dirname, '..', '.gitattributes'), 'utf8'), /^\* text=auto eol=lf$/m);
  assert.ok(os.EOL); // (keeps `os` used on every system)
});

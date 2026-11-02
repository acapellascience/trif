'use strict';
// Tests for several helpers on one workspace (helper/lib/helpers.js): each host's own socket
// (helper-<pid>.sock), stale-socket cleanup, `trif --browser` and TRIF_SOCK routing, plus the
// logger's EPIPE handling that kept orphaned helpers spinning.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { FakeExtension, runCli, writeMod, tempDir, waitFor, REPO, privDir } = require('./fake-extension');
const { removeStaleSockets, helperSockets } = require('../helper/lib/helpers');

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

const requestsOf = (ext, cmd) => ext.messages.filter((m) => m.type === 'request' && m.cmd === cmd);

// A pid that certainly isn't running: a child that has already exited.
async function deadPid() {
  const child = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' });
  await new Promise((r) => child.on('exit', r));
  return child.pid;
}

// Two hosts on one home, saying hello as the given browsers; the first owns helper.sock.
async function twoBrowsers(first = 'Chrome', second = 'Firefox') {
  const home = tempDir();
  writeMod(home, 'a.com', 'm.js', 'x');
  const a = startHost(home);
  a.hello({ browser: first, chrome: first === 'Firefox' ? '159.0' : '140.0.0.0' });
  await a.waitForSocket(15000);
  const b = startHost(home);
  b.hello({ browser: second, chrome: second === 'Firefox' ? '159.0' : '141.0.0.0' });
  await b.waitForSocket(15000, b.ownSock);
  for (const [ext, name] of [[a, 'a'], [b, 'b']]) {
    ext.handlers.tabs = () => [{ id: name === 'a' ? 1 : 2, windowId: 1, active: true, url: `https://${name}.example/`, title: `Tab ${name}` }];
    ext.handlers.status = () => ({ userScripts: true, chrome: '140.0.0.0', version: '0.1.0', mods: [], recording: [] });
  }
  // Both helpers have recorded their hello.
  await waitFor(async () => {
    const pings = await Promise.all([a.ownSock, b.ownSock].map((s) => sockRequest(s, { id: 'h', cmd: 'ping' }).catch(() => null)));
    return pings.every((p) => p && p.result.extension);
  }, { timeout: 15000, message: 'both hellos' });
  return { home, a, b };
}

// ------------------------------------------------------------------ each host's own socket

test('host: serves its own helper-<pid>.sock (0600) next to helper.sock, and removes it on exit', async () => {
  const home = tempDir();
  const ext = startHost(home);
  await ext.waitForSocket();
  await ext.waitForSocket(5000, ext.ownSock);
  assert.equal(fs.statSync(ext.ownSock).mode & 0o777, 0o600);
  const own = await sockRequest(ext.ownSock, { id: 1, cmd: 'ping' });
  assert.equal(own.result.pid, ext.child.pid);
  assert.equal(own.result.sock, ext.ownSock);
  assert.equal(own.result.role, 'primary');
  const shared = await sockRequest(ext.sock, { id: 2, cmd: 'ping' });
  assert.equal(shared.result.pid, ext.child.pid);

  const r = await ext.close();
  assert.equal(r.code, 0);
  assert.ok(!fs.existsSync(ext.ownSock), 'own socket removed');
  assert.ok(!fs.existsSync(ext.sock), 'helper.sock removed');
});

test('host: a second helper answers on its own socket as secondary; page commands reach its own browser', async () => {
  const home = tempDir();
  writeMod(home, 'a.com', 'm.js', 'x');
  const a = startHost(home);
  await a.waitForSocket();
  const b = startHost(home);
  await b.waitForSocket(5000, b.ownSock);
  a.handlers.run = () => ({ value: 'from a' });
  b.handlers.run = () => ({ value: 'from b' });

  const ping = await sockRequest(b.ownSock, { id: 1, cmd: 'ping' });
  assert.equal(ping.result.pid, b.child.pid);
  assert.equal(ping.result.role, 'secondary');
  assert.equal((await sockRequest(a.sock, { id: 2, cmd: 'ping' })).result.pid, a.child.pid);

  const viaB = await sockRequest(b.ownSock, { id: 3, cmd: 'run', args: { code: '1' } });
  assert.equal(viaB.ok, true, viaB.error);
  assert.deepEqual(viaB.result, { value: 'from b' });
  assert.equal(requestsOf(b, 'run').length, 1);
  assert.equal(requestsOf(a, 'run').length, 0);

  const viaShared = await sockRequest(a.sock, { id: 4, cmd: 'run', args: { code: '2' } });
  assert.deepEqual(viaShared.result, { value: 'from a' });
  assert.equal(requestsOf(b, 'run').length, 1);
});

// ------------------------------------------------------------------ stale sockets

test('removeStaleSockets: removes sockets of dead pids, keeps live ones and our own', () => {
  const home = tempDir();
  for (const name of ['helper-101.sock', 'helper-202.sock', `helper-${process.pid}.sock`, 'helper.sock', 'helper-x.sock']) {
    fs.writeFileSync(path.join(home, name), '');
  }
  assert.deepEqual(helperSockets(home).map((h) => h.pid), [101, 202, process.pid].sort((x, y) => x - y));
  const removed = removeStaleSockets(home, (pid) => pid === 202);
  assert.deepEqual(removed, [path.join(home, 'helper-101.sock')]);
  for (const kept of ['helper-202.sock', `helper-${process.pid}.sock`, 'helper.sock', 'helper-x.sock']) {
    assert.ok(fs.existsSync(path.join(home, kept)), `${kept} kept`);
  }
  assert.deepEqual(removeStaleSockets(path.join(home, 'missing')), []);
});

test('host: removes a helper-<pid>.sock left by a helper that died', async () => {
  const home = tempDir();
  const stale = path.join(home, `helper-${await deadPid()}.sock`);
  fs.writeFileSync(stale, '');
  const ext = startHost(home);
  await ext.waitForSocket(5000, ext.ownSock);
  await waitFor(() => !fs.existsSync(stale), { message: 'stale socket removed' });
  assert.match(fs.readFileSync(path.join(privDir(home), 'helper.log'), 'utf8'), /removed stale socket .*helper-\d+\.sock/);
});

// ------------------------------------------------------------------ CLI routing

test('trif --browser <name|pid> reaches that browser; plain commands go to the default', async () => {
  const { home, a, b } = await twoBrowsers();
  let r = await runCli(['tabs', '--json'], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout)[0].url, 'https://a.example/');

  r = await runCli(['tabs', '--json', '--browser', 'firefox'], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout)[0].url, 'https://b.example/');
  r = await runCli(['tabs', '--json', '--browser', 'Chrome'], { home });
  assert.equal(JSON.parse(r.stdout)[0].url, 'https://a.example/');
  r = await runCli(['tabs', '--json', '--browser', String(b.child.pid)], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout)[0].url, 'https://b.example/');

  // status mentions the other browser.
  r = await runCli(['status'], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`also {10}Firefox 159\\.0 \\(pid ${b.child.pid}\\); pick one with --browser`));
  r = await runCli(['status', '--browser', 'firefox'], { home });
  assert.match(r.stdout, new RegExp(`also {10}Chrome 140\\.0\\.0\\.0 \\(pid ${a.child.pid}, the default\\)`));
  r = await runCli(['status', '--json'], { home });
  assert.deepEqual(JSON.parse(r.stdout).otherBrowsers.map((o) => o.pid), [b.child.pid]);
});

test('trif --browser: an unknown name errors, listing the connected browsers', async () => {
  const { home, a, b } = await twoBrowsers();
  const r = await runCli(['tabs', '--browser', 'safari'], { home });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /no connected browser matches --browser safari/);
  assert.match(r.stderr, new RegExp(`Chrome 140\\.0\\.0\\.0 \\(pid ${a.child.pid}, the default\\)`));
  assert.match(r.stderr, new RegExp(`Firefox 159\\.0 \\(pid ${b.child.pid}\\)`));
});

test('trif --browser: two of the same browser asks for a pid', async () => {
  const { home, a, b } = await twoBrowsers('Chrome', 'Chrome');
  const r = await runCli(['tabs', '--browser', 'chrome'], { home });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /more than one Chrome is connected .*--browser <pid>/);
  assert.match(r.stderr, new RegExp(`pid ${a.child.pid}`));
  assert.match(r.stderr, new RegExp(`pid ${b.child.pid}`));
  const byPid = await runCli(['tabs', '--json', '--browser', String(a.child.pid)], { home });
  assert.equal(JSON.parse(byPid.stdout)[0].url, 'https://a.example/');
});

test('TRIF_SOCK routes plain commands to that helper; --browser is refused inside an agent run', async () => {
  const { home, b } = await twoBrowsers();
  let r = await runCli(['tabs', '--json'], { home, env: { TRIF_SOCK: b.ownSock } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout)[0].url, 'https://b.example/');
  assert.equal(requestsOf(b, 'tabs').length, 1);

  r = await runCli(['tabs', '--browser', 'chrome'], { home, env: { TRIF_RUN_TOKEN: 'tok', TRIF_SOCK: b.ownSock } });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /--browser can't be used inside a side-panel agent run/);
  assert.equal(requestsOf(b, 'tabs').length, 1, 'nothing sent');
});

// ------------------------------------------------------------------ logger

test('logger: an EPIPE on stderr does not loop through uncaughtException', async () => {
  const home = tempDir();
  const log = path.join(home, 'x.log');
  // Like host.js: errors go to the log and stderr, and uncaught exceptions are logged.
  const script = `
const { createLogger } = require(${JSON.stringify(path.join(REPO, 'helper', 'lib', 'log.js'))});
const logger = createLogger(${JSON.stringify(log)}, { stderr: true });
process.on('uncaughtException', (e) => logger.error('uncaught exception:', e && e.message));
process.stdin.once('data', () => {
  for (let i = 0; i < 5; i++) logger.error('line ' + i);
  setTimeout(() => process.exit(0), 300);
});
process.stdout.write('ready\\n');`;
  const child = spawn(process.execPath, ['-e', script], { stdio: ['pipe', 'pipe', 'pipe'] });
  cleanups.push(() => child.kill('SIGKILL'));
  await new Promise((r) => child.stdout.once('data', r));
  child.stderr.destroy(); // the reader goes away, like a dead browser or test runner
  await new Promise((r) => setTimeout(r, 100));
  child.stdin.write('go\n');
  const exited = await Promise.race([
    new Promise((r) => child.on('exit', (code) => r(code))),
    new Promise((r) => setTimeout(() => r('timeout'), 5000)),
  ]);
  assert.equal(exited, 0, 'exited promptly');
  const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
  assert.ok(lines.length < 20, `log has ${lines.length} lines`);
  assert.ok(lines.some((l) => l.includes('line 4')));
});

test('codeStamp: the newest .js change under a folder, so a helper notices its code changed', () => {
  const { codeStamp } = require('../helper/lib/helpers');
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wm-code-'));
  try {
    fs.mkdirSync(path.join(dir, 'lib'));
    fs.writeFileSync(path.join(dir, 'host.js'), '1');
    fs.writeFileSync(path.join(dir, 'lib', 'a.js'), '1');
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(path.join(dir, 'host.js'), old, old);
    fs.utimesSync(path.join(dir, 'lib', 'a.js'), old, old);
    const before = codeStamp(dir);
    fs.writeFileSync(path.join(dir, 'notes.md'), 'x'); // not code
    assert.equal(codeStamp(dir), before);
    fs.writeFileSync(path.join(dir, 'lib', 'a.js'), '2');
    assert.ok(codeStamp(dir) > before);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

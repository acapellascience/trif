'use strict';
// Problem reports (helper/lib/report.js), the helper's report.build / update.* commands, and
// `trif report`.

const test = require('./posix-only')('helpers on Unix sockets, macOS paths');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { FakeExtension, tempDir, runCli, privDir } = require('./fake-extension');
const { scrub, logProblems, buildReport, reportEmail } = require('../helper/lib/report');

test('scrub removes the home folder, user name, emails, query strings and tokens, but keeps extension IDs', () => {
  const t = scrub([
    'log at /Users/alice/.trif/helper.log and /home/bob/x',
    'Alice wrote alice@example.com',
    'opened https://x.com/i/flow?token=abc&next=1',
    'session 7f51ddf4b1dd486e85ab7caf3965fd41aa and id iaablflfafmonebdomeikadolkgdbkhe',
  ].join('\n'), { home: '/Users/alice', user: 'alice' });
  assert.equal(t, [
    'log at ~/.trif/helper.log and /home/<user>/x',
    '<user> wrote <email>',
    'opened https://x.com/i/flow?…',
    'session <redacted> and id iaablflfafmonebdomeikadolkgdbkhe',
  ].join('\n'));
});

test('logProblems keeps recent warnings and errors and folds repeats', () => {
  const home = tempDir();
  const log = path.join(privDir(home), 'helper.log');
  const now = Date.parse('2026-11-01T12:00:00Z');
  fs.writeFileSync(log, [
    '2026-10-20T10:00:00.000Z [1] ERROR too old',
    '2026-11-01T10:00:00.000Z [2] INFO fine',
    '2026-11-01T10:01:00.000Z [2] WARN extension could not register x.com/a: timed out',
    '2026-11-01T10:01:01.000Z [2] WARN extension could not register amazon.com/b: timed out',
    '2026-11-01T10:02:00.000Z [2] WARN request h7 (status) timed out after 10000ms',
    '2026-11-01T10:03:00.000Z [2] WARN request h9 (status) timed out after 10000ms',
    '2026-11-01T10:04:00.000Z [2] ERROR something else',
  ].join('\n'));
  assert.deepStrictEqual(logProblems(log, { now }), [
    '2026-11-01 10:01 WARN extension could not register <mod>: timed out (×2, e.g. x.com/a)',
    '2026-11-01 10:03 WARN request hN (status) timed out after 10000ms (×2)',
    '2026-11-01 10:04 ERROR something else',
  ]);
  assert.deepStrictEqual(logProblems(path.join(home, 'none.log')), []);
});

test('buildReport lists what helps and nothing personal', () => {
  const text = buildReport({
    description: 'Plain X shows nothing',
    site: 'x.com', siteOn: true, browser: 'Firefox 153', extensionVersion: '0.1.1',
    agents: [{ id: 'claude', available: true, version: '2.1.312', loggedIn: true }, { id: 'codex', available: false }],
    update: { available: true, latest: '0.1.2' },
    mods: [{ id: 'x.com/plain-x', enabled: true, registered: true }, { id: 'x.com/punk', enabled: false }, { id: 'x.com/new', enabled: true, registered: false, error: 'SyntaxError' }],
    doctor: { checks: [{ status: 'ok', title: 'node' }, { status: 'warn', title: 'CLI not on PATH (/Users/zed/.trif/bin)' }] },
  }, { home: '/Users/zed', user: 'zed' });
  for (const want of ['What happened\nPlain X shows nothing', 'Browser     Firefox 153 (extension 0.1.1)', 'claude 2.1.312 (logged in), codex not found',
    'Updates     0.1.2 available', 'Site        x.com, TRIF on', 'x.com/plain-x: on, running', 'x.com/punk: off', 'x.com/new: on, not running (error: SyntaxError)',
    'Doctor      1 ok, 1 warning, 0 problems', 'warn  CLI not on PATH (~/.trif/bin)']) {
    assert.ok(text.includes(want), `report has ${JSON.stringify(want)}:\n${text}`);
  }
  assert.doesNotMatch(text, /zed/);
});

test('reportUrl and reportLink: the form from package.json bugs.url, the report after the #', () => {
  const { reportUrl, reportLink } = require('../helper/lib/report');
  const root = tempDir();
  assert.equal(reportUrl(root), null);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ bugs: { url: 'https://timsrobot.com/report' } }));
  assert.equal(reportUrl(root), 'https://timsrobot.com/report');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ bugs: { url: 'http://insecure.example/report' } }));
  assert.equal(reportUrl(root), null);
  const link = reportLink('https://timsrobot.com/report', 'TRIF 0.1.1\nx & y', 'x.com');
  assert.equal(link.split('#')[0], 'https://timsrobot.com/report');
  const params = new URLSearchParams(link.split('#')[1]);
  assert.deepStrictEqual([params.get('r'), params.get('s')], ['TRIF 0.1.1\nx & y', 'x.com']);
});

test('reportEmail comes from package.json bugs.email', () => {
  const root = tempDir();
  assert.equal(reportEmail(root), null);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ bugs: { email: 'reports@example.com' } }));
  assert.equal(reportEmail(root), 'reports@example.com');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ bugs: { email: 'not an address' } }));
  assert.equal(reportEmail(root), null);
});

let reqN = 0;
function extRequest(ext, cmd, args = {}) {
  const id = `r${++reqN}`;
  ext.send({ type: 'request', id, cmd, args });
  return ext.next((m) => m.type === 'response' && m.id === id, { timeout: 20000 });
}

function sockRequest(sock, msg) {
  return new Promise((resolve, reject) => {
    const s = net.connect(sock);
    let buf = '';
    s.setEncoding('utf8');
    s.on('connect', () => s.write(JSON.stringify(msg) + '\n'));
    s.on('data', (d) => { buf += d; const nl = buf.indexOf('\n'); if (nl !== -1) { s.destroy(); resolve(JSON.parse(buf.slice(0, nl))); } });
    s.on('error', reject);
  });
}

test('a Firefox add-on older than the helper is told to update itself; an unknown command says the add-on is behind', async (t) => {
  const VERSION = require('../package.json').version;
  const home = tempDir();
  const ext = new FakeExtension({ home });
  t.after(() => ext.close());
  await ext.waitForSocket();
  const since = ext.messages.length;
  ext.send({ type: 'hello', version: '0.0.1', userScripts: true, chrome: '153', browser: 'Firefox' });
  const u = await ext.next((m) => m.type === 'update', { since });
  // (What an older panel already shows: "<latest> is available", with `why` under it.)
  assert.equal(u.update.available, true);
  assert.equal(u.update.latest, VERSION);
  assert.equal(u.update.canInstall, false);
  assert.match(u.update.why, /The Firefox add-on is still 0\.0\.1.*about:addons.*Check for Updates/);
  ext.handlers.sweep = () => { throw new Error('unknown command: sweep'); };
  const r = await sockRequest(ext.sock, { id: 's', cmd: 'sweep', args: { selector: 'a' } });
  assert.equal(r.ok, false);
  assert.match(r.error, /Firefox extension is version 0\.0\.1 and doesn't know `sweep` yet.*Check for Updates/);
});

test('the helper answers report.build and update.*, and tells the extension about updates on hello', async (t) => {
  const home = tempDir();
  const ext = new FakeExtension({ home });
  t.after(() => ext.close());
  await ext.waitForSocket();
  const VERSION = require('../package.json').version;
  ext.send({ type: 'hello', version: VERSION, userScripts: true, chrome: '153', browser: 'Firefox' });
  const u = await ext.next((m) => m.type === 'update');
  // The repo isn't an installed copy, so it can't update itself.
  assert.equal(u.update.canInstall, false);
  assert.match(u.update.why, /git checkout|not .*app/);
  assert.equal(u.update.auto, false);

  let r = await extRequest(ext, 'report.build', { site: 'x.com', siteOn: true, mods: [{ id: 'x.com/plain-x', enabled: true, registered: true }] });
  assert.equal(r.ok, true, r.error);
  assert.match(r.result.text, /^TRIF problem report/);
  assert.match(r.result.text, new RegExp(`Browser {5}Firefox 153 \\(extension ${VERSION.replace(/\./g, '\\.')}\\)`));
  assert.match(r.result.text, /x\.com\/plain-x: on, running/);
  assert.equal(r.result.url, 'https://timsrobot.com/report');
  assert.equal(r.result.email, 'reports@timsrobot.com');

  r = await extRequest(ext, 'update.setAuto', { on: true });
  assert.equal(r.result.auto, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(privDir(home), 'config.json'), 'utf8')).autoUpdate, true);
  r = await extRequest(ext, 'update.setAuto', { on: false });
  assert.equal(r.result.auto, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(privDir(home), 'config.json'), 'utf8')).autoUpdate, undefined);

  r = await extRequest(ext, 'update.install', {});
  assert.equal(r.ok, false);
  assert.match(r.error, /git checkout|not .*app/);

  // Never from inside an agent run.
  const res = await sockRequest(ext.sock, { id: 'x', cmd: 'update.install', args: {}, token: 'not-a-run' });
  assert.equal(res.ok, false);
});

test('trif report prints a report without a browser', async () => {
  const home = tempDir();
  const r = await runCli(['report'], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^TRIF problem report/);
  assert.match(r.stdout, /The browser isn't connected/);
  assert.match(r.stdout, /Send this, with what went wrong, with the form at https:\/\/timsrobot\.com\/report .*, or email it to reports@timsrobot\.com\./);
});

'use strict';
// docs/WHOLE-BOX.md step 3: when TRIF's full sandbox refuses something, a run that fails says what
// (helper/lib/boxrefusals.js: Seatbelt's reports, tagged per run in its profile, read with `log stream`;
// the allowlist proxy's refusals). The parts with stand-ins, then the real Seatbelt on this Mac (a shell
// in a box of its own, reading a scratch file: never anyone's files), then runs.js's end of a run.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const { EventEmitter } = require('events');
const { spawnSync } = require('child_process');
const br = require('../helper/lib/boxrefusals');
const wb = require('../helper/lib/wholebox');

const temp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trif-refusals-')));

test('boxrefusals: a report read, said in words, summed up; the proxy\'s refusals; the tag', () => {
  assert.equal(br.tagFor('r12-ab'), 'TRIF-box-r12-ab');
  assert.equal(br.tagFor('r1"; (allow default)'), 'TRIF-box-r1allowdefault', 'nothing that could leave the SBPL string');
  const tag = 'TRIF-box-r1';
  assert.deepStrictEqual(br.parseReport('Sandbox: claude(123) deny(1) file-read-data /Users/a/.ssh/id_rsa\nTRIF-box-r1', tag), { process: 'claude', pid: 123, op: 'file-read-data', target: '/Users/a/.ssh/id_rsa' });
  assert.equal(br.parseReport('Sandbox: claude(123) deny(1) file-read-data /x\nTRIF-box-r2', tag), null, 'another run\'s');
  assert.equal(br.parseReport('something else TRIF-box-r1', tag), null);
  assert.deepStrictEqual(br.parseReport('Sandbox: node(9) deny(1) mach-lookup com.apple.pasteboard.1\nTRIF-box-r1', tag).op, 'mach-lookup');
  const home = '/Users/a';
  const d = (op, target, p = 'claude') => br.describe({ process: p, op, target }, { home });
  assert.equal(d('file-read-data', '/Users/a/.ssh/id_rsa'), 'reading ~/.ssh/id_rsa (claude)');
  assert.equal(d('file-write-create', '/Users/ab/x'), 'writing /Users/ab/x (claude)', 'not someone else\'s home as ~');
  assert.equal(d('network-outbound', '*:443'), 'a connection to 443 (claude)');
  assert.equal(d('network-outbound', '1.1.1.1:443'), 'a connection to 1.1.1.1:443 (claude)');
  assert.equal(d('mach-lookup', 'com.apple.pasteboard.1', 'osascript'), 'the system service com.apple.pasteboard.1 (osascript)');
  assert.equal(d('process-exec*', '/Applications/X.app/Contents/MacOS/X'), 'starting /Applications/X.app/Contents/MacOS/X (claude)');
  assert.equal(d('iokit-open', 'AppleKeyStore'), 'iokit-open AppleKeyStore (claude)');
  assert.equal(br.describe({ kind: 'proxy', target: 'evil.example:443' }), 'a connection to evil.example:443');
  assert.deepStrictEqual(br.fromProxy([{ target: 'api.anthropic.com:443', allowed: true }, { target: 'evil.example:443', allowed: false }]), [{ kind: 'proxy', target: 'evil.example:443' }]);
  assert.equal(br.summary([]), '');
  const many = Array.from({ length: 8 }, (_, i) => ({ process: 'claude', op: 'file-read-data', target: `/Users/a/f${i}` }));
  assert.equal(br.summary(many, { home }), 'TRIF\'s full sandbox refused reading ~/f7 (claude); reading ~/f6 (claude); reading ~/f5 (claude); reading ~/f4 (claude); reading ~/f3 (claude); and 3 more (in the run\'s log).', 'the latest first');
  assert.equal(br.summary([{ kind: 'proxy', target: 'evil.example:443' }]), 'TRIF\'s full sandbox refused a connection to evil.example:443.');
});

function fakeLog({ exitCode = null, header = true } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => { child.emit('exit', null, 'SIGTERM'); };
  setImmediate(() => {
    if (header) child.stdout.write('Filtering the log data using "eventMessage CONTAINS \\"TRIF-box-r1\\""\n');
    if (exitCode !== null) { child.stderr.write('log: Must be admin to run \'stream\' command\n'); setImmediate(() => child.emit('exit', exitCode, null)); }
  });
  return child;
}

test('boxrefusals.watch: ready once log stream reads; only this run\'s reports, no duplicates, no noise, capped; without log stream, says why', async () => {
  let args = null;
  let child = null;
  const w = br.watch('TRIF-box-r1', { spawnLog: (a) => { args = a; child = fakeLog(); return child; } });
  assert.deepStrictEqual(args, ['stream', '--style', 'ndjson', '--predicate', 'eventMessage CONTAINS "TRIF-box-r1"']);
  assert.equal(await w.ready, true);
  const line = (msg) => child.stdout.write(`${JSON.stringify({ eventMessage: msg })}\n`);
  line('Sandbox: claude(5) deny(1) file-read-data /Users/a/.netrc\nTRIF-box-r1');
  line('Sandbox: claude(5) deny(1) file-read-data /Users/a/.netrc\nTRIF-box-r1');
  line('Sandbox: sh(6) deny(1) file-ioctl path:/dev/dtracehelper ioctl-command:(_IO "h" 4)\nTRIF-box-r1');
  line('Sandbox: claude(5) deny(1) file-read-data /x\nTRIF-box-r9');
  child.stdout.write('not json\n');
  for (let i = 0; i < br.MAX + 5; i++) line(`Sandbox: claude(5) deny(1) file-write-create /t/${i}\nTRIF-box-r1`);
  await new Promise((r) => setImmediate(r));
  const got = w.refusals();
  assert.equal(got.length, br.MAX);
  assert.deepStrictEqual(got[0], { process: 'claude', pid: 5, op: 'file-read-data', target: '/Users/a/.netrc' });
  assert.ok(!got.some((r) => /dtracehelper|\/x$/.test(r.target)));
  w.close();
  assert.equal(w.unavailable(), null);

  const no = br.watch('TRIF-box-r1', { spawnLog: () => fakeLog({ exitCode: 64, header: false }) });
  assert.equal(await no.ready, false);
  assert.match(no.unavailable(), /Must be admin/);
  const thrown = br.watch('TRIF-box-r1', { spawnLog: () => { throw new Error('no /usr/bin/log'); } });
  assert.equal(await thrown.ready, false);
  assert.equal(thrown.unavailable(), 'no /usr/bin/log');
  // (no header at all: goes on after readyMs)
  const quiet = br.watch('TRIF-box-r1', { spawnLog: () => fakeLog({ header: false }), readyMs: 50 });
  assert.equal(await quiet.ready, true);
  quiet.close();
});

// The real thing: a shell in a box of its own (wholebox.macProfile with the tag), refused a read of a
// scratch file outside it and a write into a read-only folder inside it; `log stream` sees both.
const LOG_OK = process.platform === 'darwin' && spawnSync('/usr/bin/log', ['stream', '--help'], { encoding: 'utf8', timeout: 5000 }).status !== null;
test('Seatbelt for real: the run\'s tag in its reports, read back as this run\'s refusals', { skip: process.platform !== 'darwin' ? 'macOS only' : !LOG_OK && 'no /usr/bin/log' }, async (t) => {
  const box = temp();
  const outside = temp();
  fs.mkdirSync(path.join(box, 'ro'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'SECRET');
  const tag = br.tagFor(`rtest${process.pid}${Date.now()}`);
  const profile = wb.macProfile({ write: [box], readOnly: [path.join(box, 'ro')], tag, home: box });
  assert.match(profile, new RegExp(`\\(deny default \\(with message "${tag}"\\)\\)`));
  fs.writeFileSync(path.join(box, 'p.sb'), profile);
  const w = br.watch(tag);
  if (!(await w.ready)) { w.close(); t.skip(`log stream refused (${w.unavailable()}): not an administrator account?`); return; }
  const r = spawnSync('/usr/bin/sandbox-exec', ['-f', path.join(box, 'p.sb'), '/bin/sh', '-c', `cat ${path.join(outside, 'secret.txt')}; echo x > ${path.join(box, 'ro', 'y')}; echo ok > ${path.join(box, 'ok')}`], { encoding: 'utf8', timeout: 20000 });
  assert.ok(!r.stdout.includes('SECRET'), r.stdout);
  assert.equal(fs.readFileSync(path.join(box, 'ok'), 'utf8'), 'ok\n', `the box let the shell write its own folder: ${r.stderr}`);
  // (reports arrive a moment later)
  for (let i = 0; i < 40 && w.refusals().length < 2; i++) await new Promise((res) => setTimeout(res, 100));
  w.close();
  const got = w.refusals();
  const info = JSON.stringify(got);
  assert.ok(got.some((x) => /^file-read/.test(x.op) && x.target === path.join(outside, 'secret.txt') && x.process === 'cat'), info);
  assert.ok(got.some((x) => /^file-write/.test(x.op) && x.target === path.join(box, 'ro', 'y')), `the read-only folder's own deny carries the tag too: ${info}`);
  assert.match(br.summary(got), /^TRIF's full sandbox refused .*reading .*secret\.txt \(cat\)/);
});

test('runs.js, the end of a boxed run: a failed run names what the box refused (an error, reason "box", and in done); a run that worked only logs it; a stopped one says nothing', async () => {
  const { Runs } = require('../helper/lib/runs');
  const claude = require('../helper/lib/agents/claude');
  const finish = (agentDone, { stopped = false, seen = [], refusals = [] } = {}) => {
    const home = temp();
    const runs = new Runs({ getWorkspace: () => home });
    const events = [];
    runs._emit = (run, ev) => events.push(ev);
    const run = {
      id: 'r1', agent: 'claude', site: 'x.com', adapter: claude, ws: { home, private: home, modsDir: path.join(home, 'sites') }, wholeBox: true,
      logFile: path.join(home, 'r1.jsonl'), state: {}, timers: [], stdoutBuf: '', stderr: '', child: null, agentDone, stopped,
      boxWatch: { refusals: () => refusals, unavailable: () => null, close() {} }, proxySeen: seen,
    };
    runs._finish(run, { code: 1, signal: null });
    const log = fs.readFileSync(run.logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    return { events, log };
  };
  const refusals = [{ process: 'claude', op: 'file-read-data', target: path.join(os.homedir(), '.netrc') }];
  const seen = [{ target: 'api.anthropic.com:443', allowed: true }, { target: 'statsig.example:443', allowed: false }];
  const failed = finish({ ok: false, result: 'API Error: Connection error.' }, { refusals, seen });
  const err = failed.events.find((e) => e.kind === 'error' && e.reason === 'box');
  assert.ok(err, JSON.stringify(failed.events));
  assert.equal(err.message, 'TRIF\'s full sandbox refused a connection to statsig.example:443; reading ~/.netrc (claude).');
  assert.deepStrictEqual(failed.events.at(-1).boxRefused, ['reading ~/.netrc (claude)', 'a connection to statsig.example:443']);
  assert.ok(failed.events.indexOf(err) < failed.events.length - 1, 'before done');
  assert.deepStrictEqual(failed.log.find((x) => x.webmods === 'boxRefused').refused, ['reading ~/.netrc (claude)', 'a connection to statsig.example:443']);
  const worked = finish({ ok: true, result: 'made it' }, { refusals });
  assert.ok(!worked.events.some((e) => e.kind === 'error') && !worked.events.at(-1).boxRefused, JSON.stringify(worked.events));
  assert.ok(worked.log.some((x) => x.webmods === 'boxRefused'), 'in the run\'s log all the same');
  const stopped = finish(null, { refusals, stopped: true });
  assert.ok(!stopped.events.some((e) => e.reason === 'box'), JSON.stringify(stopped.events));
  const none = finish({ ok: false, result: 'no' });
  assert.ok(!none.events.some((e) => e.reason === 'box') && !none.log.some((x) => x.webmods === 'boxRefused'));
});

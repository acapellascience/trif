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
  assert.equal(d('network-outbound', '*:443'), 'a connection to port 443 (claude)');
  assert.equal(d('network-outbound', 'remote:*:80'), 'a connection to port 80 (claude)', 'as Seatbelt reported it on CI');
  assert.equal(d('network-outbound', 'remote:192.0.2.1:80'), 'a connection to 192.0.2.1:80 (claude)');
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

// Step 3b: what every boxed run is refused (round 5's CI, real pinned Claude Code runs that worked) is left
// out of a failed run's error; anything else, the same files to other programs included, isn't.
test('boxrefusals.routine: what every boxed run is refused, and nothing else', () => {
  const c = br.routineContext({ homes: ['/Users/runner', '/Users/runner/fake'], privateDir: '/Users/runner/fake/Library/Application Support/TRIF', workspace: '/Users/runner/fake/.trif', agentTmp: '/tmp/trif-834c4fef' });
  const r = (process, op, target) => br.routine({ process, op, target }, c);
  // (round 5's CI list, as it came)
  for (const [p, o, t] of [
    ['claude', 'ipc-posix-shm-read-data', 'apple.shm.notification_center'],
    ['security', 'file-read-data', '/Users/runner/.CFUserTextEncoding'],
    ['security', 'mach-lookup', 'com.apple.analyticsd'],
    ['security', 'mach-lookup', 'com.apple.SecurityServer'],
    ['claude', 'mach-lookup', 'com.apple.securityd.xpc'],
    ['claude', 'mach-lookup', 'com.apple.FSEvents'],
    ['security', 'file-read-data', '/Users/runner/Library/Preferences/ByHost/.GlobalPreferences.3408CF31-A8F1-57DE-9DE9-4926DA8F94A4.plist'],
    ['security', 'file-read-data', '/Users/runner/Library/Preferences/.GlobalPreferences.plist'],
    ['security', 'file-read-data', '/Users/runner/Library/Preferences/.GlobalPreferences_m.plist'],
    ['git', 'file-read-data', '/Applications/Xcode_26.6.app/Contents/Developer/usr/lib/libxcrun.dylib'],
    ['git', 'file-read-metadata', '/Applications/Xcode_26.6.app/Contents/Developer/usr/lib'],
    ['git', 'file-read-data', '/Library/Developer/CommandLineTools/usr/lib/libxcrun.dylib'],
    ['claude', 'network-bind', '/private/tmp/trif-834c4fef/cc-socks/4961.sock'],
    ['claude', 'network-bind', '/private/tmp/trif-834c4fef/srt-mux-5433-0.sock'],
    ['claude', 'file-write-create', '/Users/runner/fake/Library/Application Support/TRIF/agent-config/claude/plugins'],
    ['claude', 'file-write-create', '/Users/runner/fake/Library/Caches/claude-cli-nodejs'],
    ['claude', 'file-write-create', '/Users/runner/fake/.claude'],
    ['claude', 'file-write-create', '/Users/runner/fake/.config'],
    ['node', 'file-read-data', '/Users/runner/fake/Library/Application Support/TRIF/config.json'],
    ['node', 'file-read-data', '/Users/runner/fake/Library/Application Support/TRIF/helper.log'],
    ['node', 'file-read-data', '/Users/runner/fake/.trif/preinstalled.json'],
  ]) assert.equal(r(p, o, t), true, `${p} ${o} ${t}`);
  for (const [p, o, t] of [
    ['claude', 'file-read-data', '/Users/runner/fake/Library/Application Support/TRIF/config.json'], // (the Read tool: not trif's)
    ['claude', 'file-read-data', '/Users/runner/fake/Library/Keychains/login.keychain-db'],
    ['node', 'file-write-create', '/Users/runner/fake/.trif/sites/other.net/probe.js'],
    ['claude', 'file-write-create', '/Users/runner/fake/.claude/settings.json'], // (inside ~/.claude: not the folder itself)
    ['claude', 'file-read-data', '/Users/runner/.ssh/id_rsa'],
    ['claude', 'network-outbound', '192.0.2.1:80'],
    ['claude', 'network-bind', '/private/tmp/trif-other/cc-socks/1.sock'], // (another run's folder)
    ['claude', 'network-bind', '/private/tmp/trif-834c4fef/other.sock'],
    ['zsh', 'file-write-create', '/private/tmp/zshNFhFaM'],
    ['claude', 'mach-lookup', 'com.apple.pasteboard.1'],
    ['security', 'file-read-data', '/Users/someoneelse/.CFUserTextEncoding'],
    ['git', 'file-read-data', '/Applications/Xcode.app/Contents/Developer/usr/lib/other.dylib'],
    ['claude', 'file-write-create', '/Users/runner/fake/Library/Application Support/TRIF/agent-config/claude/plugins/x'],
  ]) assert.equal(r(p, o, t), false, `${p} ${o} ${t}`);
  assert.equal(br.routine({ kind: 'proxy', target: 'api.anthropic.com:443' }, c), false, 'the proxy\'s refusals never are');
  assert.equal(br.routine({ process: 'claude', op: 'ipc-posix-shm-read-data', target: 'apple.shm.notification_center' }, null), false, 'no context: none');
  // (a path with characters a pattern would read as its own, and $HOME's and the account's by default)
  const odd = br.routineContext({ privateDir: '/Users/a (b)/T+R.I$F', agentTmp: '/private/tmp/trif-x/' });
  assert.equal(br.routine({ process: 'node', op: 'file-read-data', target: '/Users/a (b)/T+R.I$F/config.json' }, odd), true);
  assert.equal(br.routine({ process: 'node', op: 'file-read-data', target: '/Users/a (b)/TTR.I$F/config.json' }, odd), false);
  assert.equal(br.routine({ process: 'claude', op: 'network-bind', target: '/tmp/trif-x/cc-socks/9.sock' }, odd), true);
  assert.ok(odd.homes.includes(os.homedir()) && odd.homes.includes(os.userInfo().homedir));
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
  const w = br.watch(tag, { readyMs: 15000 }); // (a fresh CI runner's first `log stream` is slow to start)
  if (!(await w.ready)) { w.close(); t.skip(`log stream refused (${w.unavailable()}): not an administrator account?`); return; }
  // (reports arrive a moment later; now and then none reaches the log at all, the kernel's reports being
  // best effort, round 8's daily run: up to three tries, a new shell each time)
  let r;
  for (let attempt = 0; attempt < 3 && w.refusals().length < 2; attempt++) {
    r = spawnSync('/usr/bin/sandbox-exec', ['-f', path.join(box, 'p.sb'), '/bin/sh', '-c', `cat ${path.join(outside, 'secret.txt')}; echo x > ${path.join(box, 'ro', 'y')}; echo ok > ${path.join(box, 'ok')}`], { encoding: 'utf8', timeout: 20000 });
    assert.ok(!r.stdout.includes('SECRET'), r.stdout);
    assert.equal(fs.readFileSync(path.join(box, 'ok'), 'utf8'), 'ok\n', `the box let the shell write its own folder: ${r.stderr}`);
    for (let i = 0; i < 60 && w.refusals().length < 2; i++) await new Promise((res) => setTimeout(res, 100));
  }
  w.close();
  const got = w.refusals();
  // (Reports are best effort: with the whole suite running at once, CI's `tests` workflow saw none in 10 s,
  // the kernel's reports being throttled under load. Strict where the box's own CI sets TRIF_TEST_BOX_REPORTS.)
  if (!got.length && !process.env.TRIF_TEST_BOX_REPORTS) { t.skip('no Seatbelt reports reached the log (throttled under load?); strict with TRIF_TEST_BOX_REPORTS=1'); return; }
  const info = `${JSON.stringify(got)} (log stream: ${w.unavailable() || 'running'}; the shell: ${r.status} ${r.stderr.trim()})`;
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
  // (3b: what every boxed run is refused is in the log, `routine`, never in the error; only that: no error)
  const usual = [{ process: 'claude', op: 'ipc-posix-shm-read-data', target: 'apple.shm.notification_center' }];
  const mixed = finish({ ok: false, result: 'API Error: Connection error.' }, { refusals: [...usual, ...refusals] });
  assert.equal(mixed.events.find((e) => e.reason === 'box').message, 'TRIF\'s full sandbox refused reading ~/.netrc (claude).');
  assert.deepStrictEqual(mixed.events.at(-1).boxRefused, ['reading ~/.netrc (claude)']);
  const mixedLog = mixed.log.find((x) => x.webmods === 'boxRefused');
  assert.deepStrictEqual([mixedLog.refused, mixedLog.routine], [['reading ~/.netrc (claude)'], ['ipc-posix-shm-read-data apple.shm.notification_center (claude)']]);
  const onlyUsual = finish({ ok: false, result: 'no' }, { refusals: usual });
  assert.ok(!onlyUsual.events.some((e) => e.reason === 'box') && !onlyUsual.events.at(-1).boxRefused, JSON.stringify(onlyUsual.events));
  assert.deepStrictEqual(onlyUsual.log.find((x) => x.webmods === 'boxRefused').routine, ['ipc-posix-shm-read-data apple.shm.notification_center (claude)']);
  const none = finish({ ok: false, result: 'no' });
  assert.ok(!none.events.some((e) => e.reason === 'box') && !none.log.some((x) => x.webmods === 'boxRefused'));
});

test('boxrefusals on Windows (9b(3)): the run\'s own lines, TRIF\'s filters\' drops, in words', () => {
  const home = 'C:\\Users\\runneradmin';
  const lines = [
    { type: 'system', subtype: 'init' },
    // the model's own words never count
    { type: 'assistant', message: { content: [{ type: 'text', text: "EPERM: operation not permitted, open 'C:\\model\\said.txt'" }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: "EPERM: operation not permitted, open 'C:\\Users\\runneradmin\\wb3-planted.txt'" }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: "Error: EACCES: permission denied, mkdir 'C:\\stage\\sites\\other.com'\nconnect EACCES 1.1.1.1:443\nconnect EACCES 1.1.1.1:443" }] }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: "Get-Content : Access to the path 'C:\\secret.txt' is denied.\nError: spawn C:\\x\\tool.exe EPERM\nspawn EPERM" }] } },
    { type: 'result', result: "connect EACCES 9.9.9.9:443 (the model's summary)" },
  ];
  const own = br.fromRunOutput({ stdout: lines.map((l) => JSON.stringify(l)).join('\r\n'), stderr: "listen EACCES: permission denied 127.0.0.1:5555\nscandir 'x'" });
  assert.deepStrictEqual(own.map((r) => [r.op, r.target]), [
    ['file-open', 'C:\\Users\\runneradmin\\wb3-planted.txt'],
    ['file-write', 'C:\\stage\\sites\\other.com'],
    ['network-outbound', '1.1.1.1:443'],
    ['process-exec', 'C:\\x\\tool.exe'],
    ['process-exec', 'a program'],
    ['file-open', 'C:\\secret.txt'],
    ['network-bind', '127.0.0.1:5555'],
  ]);
  assert.ok(own.every((r) => r.kind === 'own'));
  assert.equal(br.describe(own[0], { home }), 'opening ~\\wb3-planted.txt');
  assert.equal(br.describe(own[1], { home }), 'writing C:\\stage\\sites\\other.com');
  assert.equal(br.describe(own[2], { home }), 'a connection to 1.1.1.1:443');
  assert.deepStrictEqual(br.fromRunOutput({ stdout: 'not json\n{"type":"user"}\n', stderr: '' }), []);
  assert.deepStrictEqual(br.fromRunOutput({}), []);

  const t0 = Date.parse('2026-11-21T10:00:00Z');
  const ev = [
    { time: '2026-11-21T09:50:00.0000000Z', layer: 'connect4', protocol: 6, remote: '127.0.0.1', remotePort: 3000, app: '\\device\\harddiskvolume4\\x\\old.exe' },
    { time: '2026-11-21T10:00:01.5000000Z', layer: 'connect4', protocol: 6, remote: '127.0.0.1', remotePort: 3000, localPort: 50000, app: '\\device\\harddiskvolume4\\hostedtoolcache\\node.exe' },
    { time: '2026-11-21T10:00:02Z', layer: 'connect4', protocol: 6, remote: '127.0.0.1', remotePort: 3000, localPort: 50001, app: '\\device\\harddiskvolume4\\hostedtoolcache\\node.exe' },
    { time: '2026-11-21T10:00:02Z', layer: 'connect6', protocol: 6, remote: '::1', remotePort: 47391, app: null },
    { time: '2026-11-21T10:00:03Z', layer: 'connect4', protocol: 17, remote: '127.0.0.1', remotePort: 53, app: 'C:\\x\\claude.exe' },
    { time: '2026-11-21T10:00:04Z', layer: 'listen4', protocol: 6, localPort: 8080, app: 'C:\\x\\claude.exe' },
    { time: '2026-11-21T10:00:05Z', layer: 'accept4', protocol: 6, remote: '10.0.0.5', remotePort: 1234 },
    'junk', null,
  ];
  const net = br.fromNetEvents(ev, { since: t0 });
  assert.deepStrictEqual(net.map((r) => br.describe(r)), [
    'a connection to 127.0.0.1:3000 (node.exe)',
    'a connection to [::1]:47391',
    'a connection to 127.0.0.1:53 (UDP) (claude.exe)',
    'listening on port 8080 (claude.exe)',
    'a connection from 10.0.0.5:1234',
  ], 'the run\'s own time only, the same connection once');
  assert.equal(br.fromNetEvents(ev).length, 6, 'no since: all');
  assert.ok(!net.some((r) => br.routine(r, br.routineContext({ homes: [home] }))), 'none routine');
  assert.match(br.summary([...own.slice(0, 1), ...net.slice(0, 1)], { home }), /^TRIF's full sandbox refused a connection to 127\.0\.0\.1:3000 \(node\.exe\); opening ~\\wb3-planted\.txt\.$/);
});

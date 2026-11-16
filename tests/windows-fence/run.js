#!/usr/bin/env node
'use strict';
// A prototype fence for side-panel agent runs' commands on Windows, tried for real (docs/WINDOWS.md "The
// sandbox"). Windows only; run by .github/workflows/windows.yml on a windows-latest runner. Nothing in
// TRIF uses the fence yet: this builds it (fence.cs, with the C# compiler Windows ships), lays out a
// scratch copy of what a run sees, runs probe.js inside the fence, and checks every attempt against what
// TRIF's sandbox guarantees on a Mac (docs/PROTOCOL.md "Run scope"):
//
//   reads     the run's working folder (its copy of the workspace), TRIF's code and node; nothing else
//             in the home folder, no other user's files
//   writes    its own site's mods (and new site folders), its mailbox, its screenshots folder; never
//             another site's mods, the guides, TRIF's state files or code
//   network   none: not the internet, not this computer's own servers, not the helper's pipe
//   private   TRIF's private folder (settings, logs, other sites' screenshots): no reads, no writes
//   others    another run's mailbox and working folder; other programs' command lines; the clipboard
//
// Twice: as a plain AppContainer and as a less-privileged one (lpac). Prints a table; exits 1 when an
// attempt marked `deny` got through or one marked `allow` didn't (the `info` rows only inform).
//
// It makes AppContainer profiles and access-control entries on its own scratch folder, writes one value
// under HKCU\Software\TRIF-fence-test, a file in the user's profile folder, and the clipboard, and removes
// them again: it refuses to run outside GitHub Actions unless given --yes-this-computer.

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

if (process.platform !== 'win32') { console.error('windows-fence: Windows only'); process.exit(2); }
if (process.env.GITHUB_ACTIONS !== 'true' && !process.argv.includes('--yes-this-computer')) {
  console.error('windows-fence: this makes AppContainer profiles and changes access-control entries.\nIt runs on GitHub Actions; elsewhere pass --yes-this-computer.');
  process.exit(2);
}

const REPO = path.resolve(__dirname, '..', '..');
const SYSROOT = process.env.SystemRoot || 'C:\\Windows';
const sys = (n) => path.join(SYSROOT, 'System32', n);
const put = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); return f; };
const rand = (n = 6) => crypto.randomBytes(n).toString('hex');
let failed = 0;

const { build, buildSpy } = require('./build');

function fence(exe, spec, { timeout = 240000 } = {}) {
  const file = path.join(os.tmpdir(), `trif-fence-spec-${rand()}.json`);
  fs.writeFileSync(file, JSON.stringify(spec));
  const t = Date.now();
  const r = spawnSync(exe, ['run', file], { encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  fs.rmSync(file, { force: true });
  return { status: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || ''), error: r.error, ms: Date.now() - t };
}

(async () => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'trif-fence-')));
  console.log(`scratch ${base}\nuser profile ${os.homedir()}\nnode ${process.execPath} ${process.version}`);
  console.log(spawnSync(sys('cmd.exe'), ['/d', '/c', 'ver'], { encoding: 'utf8' }).stdout.trim());
  // (who runs this: an administrator, as GitHub's runner account is, or an ordinary user)
  console.log(`run by ${os.userInfo().username}; administrator: ${/S-1-5-32-544.*Enabled group/.test(spawnSync(sys('whoami.exe'), ['/groups', '/fo', 'csv', '/nh'], { encoding: 'utf8' }).stdout.split(/\r?\n/).filter((l) => l.includes('S-1-5-32-544')).join(' ')) ? 'yes' : 'no'}`);
  const exe = build(path.join(base, 'bin'));

  // ---- what a run sees, as on a user's computer: everything inside the user's profile folder
  const CANARY = `CANARY-${rand(8)}`;
  const home = path.join(base, 'home');                       // stands in for the rest of the home folder
  put(path.join(home, 'secret.txt'), `${CANARY} home`);
  put(path.join(home, '.ssh', 'id_ed25519'), `${CANARY} ssh`);
  const priv = path.join(base, 'private');                    // TRIF's private folder
  put(path.join(priv, 'config.json'), `{"canary":"${CANARY} private"}`);
  put(path.join(priv, 'screenshots', 'y.com', 'shot.png'), `${CANARY} other site's screenshot`);
  const shots = path.join(priv, 'screenshots', 'x.com');
  fs.mkdirSync(shots, { recursive: true });
  const live = path.join(base, 'ws');                         // the real workspace: only the helper touches it
  put(path.join(live, 'held.json'), '{}');
  put(path.join(live, 'allowed.json'), '{}');
  put(path.join(live, 'sites', 'x.com', 'live.js'), '// live');
  const boxes = path.join(base, 'boxes');
  const stage = path.join(boxes, 'r1.ws');                    // the run's working folder (stage.js)
  put(path.join(stage, 'AGENTS.md'), '# guide');
  put(path.join(stage, '.shipped', 'x.com', 'a.js'), '// shipped');
  put(path.join(stage, 'sites', 'x.com', 'own.js'), '// own');
  put(path.join(stage, 'sites', 'y.com', 'other.js'), '// other');
  put(path.join(stage, 'sites', 'y.com', 'keep.js'), '// keep');
  put(path.join(stage, 'sites', 'all-sites', 'dark.js'), '// all');
  const box = path.join(boxes, 'r1');                         // its mailbox
  fs.mkdirSync(path.join(box, 'tmp'), { recursive: true });
  put(path.join(boxes, 'r2', 'request.json'), `${CANARY} another run's mailbox`);
  put(path.join(boxes, 'r2.ws', 'sites', 'bank.com', 'm.js'), `${CANARY} another run's copy`);
  // TRIF's code as setup --copy leaves it (what runs.js trifCode lists), and node as nvm or Volta has it
  const app = path.join(base, 'app');
  for (const item of ['helper', 'package.json', path.join('extension', 'explain.json'), path.join('extension', 'pagewide.js'), 'examples']) fs.cpSync(path.join(REPO, item), path.join(app, item), { recursive: true });
  fs.cpSync(__dirname, path.join(app, 'fence-test'), { recursive: true });
  const nodeDir = path.join(base, 'node');
  fs.mkdirSync(nodeDir);
  fs.copyFileSync(process.execPath, path.join(nodeDir, 'node.exe'));
  const node = path.join(nodeDir, 'node.exe');
  const probe = path.join(app, 'fence-test', 'probe.js');
  const spy = buildSpy(path.join(app, 'fence-test'));

  // ---- things outside the files: servers, a pipe as the helper makes it, another program, the registry
  let tcpHits = 0;
  let pipeHits = 0;
  const server = net.createServer((s) => { tcpHits++; s.destroy(); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  let udpHits = 0;
  const udpServer = require('dgram').createSocket('udp4');
  udpServer.on('message', () => { udpHits++; });
  await new Promise((r) => udpServer.bind(0, '127.0.0.1', r));
  const udpPort = udpServer.address().port;
  const pipeName = `\\\\.\\pipe\\trif-${rand(16)}`;
  const pipeServer = net.createServer((s) => { pipeHits++; s.destroy(); });
  await new Promise((r) => pipeServer.listen(pipeName, r));
  const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)', `${CANARY}-argv`], { stdio: 'ignore', env: { ...process.env, TRIF_FENCE_SECRET: `${CANARY}-env` } });
  const REG_KEY = 'HKCU\\Software\\TRIF-fence-test';
  spawnSync(sys('reg.exe'), ['add', REG_KEY, '/v', 'secret', '/t', 'REG_SZ', '/d', `${CANARY} registry`, '/f']);
  const profileCanary = path.join(os.homedir(), `trif-fence-canary-${rand()}.txt`);
  fs.writeFileSync(profileCanary, `${CANARY} profile`);
  spawnSync(sys('clip.exe'), [], { input: `${CANARY} clipboard` });

  const PSEXE = path.join(SYSROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  // ---- every attempt: expect 'allow' (a run needs it), 'deny' (a guarantee), 'info' (to know)
  const ops = [
    // what a run needs
    { id: 'read its working folder (AGENTS.md)', g: 'works', expect: 'allow', op: 'read', path: path.join(stage, 'AGENTS.md') },
    { id: 'list its working folder', g: 'works', expect: 'allow', op: 'list', path: stage },
    { id: 'read .shipped/', g: 'works', expect: 'allow', op: 'read', path: path.join(stage, '.shipped', 'x.com', 'a.js') },
    { id: 'read another site\'s mod', g: 'works', expect: 'allow', op: 'read', path: path.join(stage, 'sites', 'y.com', 'other.js') },
    { id: 'read TRIF\'s code', g: 'works', expect: 'allow', op: 'read', path: path.join(app, 'helper', 'cli.js') },
    { id: 'write a mod for its site', g: 'works', expect: 'allow', op: 'write', path: path.join(stage, 'sites', 'x.com', 'new.js') },
    { id: 'change a mod of its site', g: 'works', expect: 'allow', op: 'append', path: path.join(stage, 'sites', 'x.com', 'own.js') },
    { id: 'change an all-sites mod', g: 'works', expect: 'allow', op: 'append', path: path.join(stage, 'sites', 'all-sites', 'dark.js') },
    { id: 'make a folder for a new site', g: 'works', expect: 'allow', op: 'mkdir', path: path.join(stage, 'sites', 'new.org') },
    { id: 'write its mailbox', g: 'works', expect: 'allow', op: 'write', path: path.join(box, 'req-1.json') },
    { id: 'write its temporary folder', g: 'works', expect: 'allow', op: 'write', path: path.join(box, 'tmp', 't.txt') },
    { id: 'write its screenshots folder', g: 'works', expect: 'allow', op: 'write', path: path.join(shots, 'a.png') },
    // reads: nothing else in the home folder
    { id: 'read a file elsewhere in the home folder', g: 'reads', expect: 'deny', op: 'read', path: path.join(home, 'secret.txt') },
    { id: 'read an ssh key', g: 'reads', expect: 'deny', op: 'read', path: path.join(home, '.ssh', 'id_ed25519') },
    { id: 'list the rest of the home folder', g: 'reads', expect: 'deny', op: 'list', path: home },
    { id: 'read a file in the real profile folder', g: 'reads', expect: 'deny', op: 'read', path: profileCanary },
    { id: 'list the real profile folder', g: 'reads', expect: 'deny', op: 'list', path: os.homedir() },
    { id: 'list C:\\Users', g: 'reads', expect: 'deny', op: 'list', path: path.dirname(os.homedir()) },
    { id: 'list the system\'s temporary folder', g: 'reads', expect: 'deny', op: 'list', path: os.tmpdir() },
    { id: 'the same with cmd.exe (type)', g: 'reads', expect: 'deny', direct: `"${sys('cmd.exe')}" /d /c type "${path.join(home, 'secret.txt')}"`, through: (r) => r.stdout.includes(CANARY) },
    { id: 'read through a junction it made', g: 'reads', expect: 'deny', op: 'junction', path: path.join(box, 'j'), target: home, file: 'secret.txt' },
    { id: 'read through a symlink it made', g: 'reads', expect: 'deny', op: 'symlink', path: path.join(box, 'sl'), target: path.join(home, 'secret.txt') },
    { id: 'read through a hard link it made', g: 'reads', expect: 'deny', op: 'hardlink', path: path.join(box, 'hl'), target: path.join(home, 'secret.txt') },
    { id: 'read the live workspace\'s state (held.json)', g: 'state', expect: 'deny', op: 'read', path: path.join(live, 'held.json') },
    { id: 'list C:\\ProgramData', g: 'reads', expect: 'info', op: 'list', path: 'C:\\ProgramData' },
    { id: 'list C:\\', g: 'reads', expect: 'info', op: 'list', path: 'C:\\' },
    { id: 'read C:\\Windows\\win.ini', g: 'reads', expect: 'info', op: 'read', path: path.join(SYSROOT, 'win.ini') },
    { id: 'list C:\\Program Files', g: 'reads', expect: 'info', op: 'list', path: 'C:\\Program Files' },
    { id: 'read a value under HKCU\\Software', g: 'reads', expect: 'info', direct: `"${sys('reg.exe')}" query ${REG_KEY} /v secret`, through: (r) => r.stdout.includes(CANARY) },
    { id: 'read HKCU\\Environment (the user\'s variables)', g: 'reads', expect: 'info', direct: `"${sys('reg.exe')}" query HKCU\\Environment`, through: (r) => r.status === 0 && /REG_/.test(r.stdout) },
    // private: TRIF's private folder
    { id: 'read TRIF\'s settings (config.json)', g: 'private', expect: 'deny', op: 'read', path: path.join(priv, 'config.json') },
    { id: 'list the private folder', g: 'private', expect: 'deny', op: 'list', path: priv },
    { id: 'read another site\'s screenshot', g: 'private', expect: 'deny', op: 'read', path: path.join(priv, 'screenshots', 'y.com', 'shot.png') },
    { id: 'write the private folder', g: 'private', expect: 'deny', op: 'write', path: path.join(priv, 'planted.json') },
    // writes: only its site's mods
    { id: 'change another site\'s mod', g: 'writes', expect: 'deny', op: 'append', path: path.join(stage, 'sites', 'y.com', 'other.js') },
    { id: 'add a mod to another site', g: 'writes', expect: 'deny', op: 'write', path: path.join(stage, 'sites', 'y.com', 'planted.js') },
    { id: 'delete another site\'s mod', g: 'writes', expect: 'deny', op: 'delete', path: path.join(stage, 'sites', 'y.com', 'keep.js') },
    { id: 'rename another site\'s folder away', g: 'writes', expect: 'deny', op: 'rename', path: path.join(stage, 'sites', 'y.com'), to: path.join(stage, 'sites', 'x.com', 'stolen') },
    { id: 'change the guide (AGENTS.md)', g: 'state', expect: 'deny', op: 'append', path: path.join(stage, 'AGENTS.md') },
    { id: 'add a file beside the guides', g: 'state', expect: 'deny', op: 'write', path: path.join(stage, 'CLAUDE.md') },
    { id: 'change .shipped/', g: 'state', expect: 'deny', op: 'append', path: path.join(stage, '.shipped', 'x.com', 'a.js') },
    { id: 'write the live workspace\'s state (allowed.json)', g: 'state', expect: 'deny', op: 'write', path: path.join(live, 'allowed.json') },
    { id: 'write the live mods folder', g: 'state', expect: 'deny', op: 'write', path: path.join(live, 'sites', 'x.com', 'planted.js') },
    { id: 'change TRIF\'s code', g: 'state', expect: 'deny', op: 'append', path: path.join(app, 'helper', 'cli.js') },
    { id: 'replace node', g: 'state', expect: 'deny', op: 'write', path: path.join(nodeDir, 'node.exe') },
    { id: 'write elsewhere in the home folder', g: 'writes', expect: 'deny', op: 'write', path: path.join(home, 'planted.txt') },
    { id: 'write the real profile folder', g: 'writes', expect: 'deny', op: 'write', path: path.join(os.homedir(), `trif-fence-planted-${rand()}.txt`) },
    { id: 'write a value under HKCU\\Software', g: 'writes', expect: 'deny', direct: `"${sys('reg.exe')}" add ${REG_KEY} /v fromInside /t REG_SZ /d x /f`, through: () => spawnSync(sys('reg.exe'), ['query', REG_KEY, '/v', 'fromInside']).status === 0 },
    // others: other runs
    { id: 'read another run\'s mailbox', g: 'others', expect: 'deny', op: 'read', path: path.join(boxes, 'r2', 'request.json') },
    { id: 'write another run\'s mailbox', g: 'others', expect: 'deny', op: 'write', path: path.join(boxes, 'r2', 'forged.json') },
    { id: 'read another run\'s working folder', g: 'others', expect: 'deny', op: 'read', path: path.join(boxes, 'r2.ws', 'sites', 'bank.com', 'm.js') },
    { id: 'list the mailboxes\' folder', g: 'others', expect: 'deny', op: 'list', path: boxes },
    // network: none
    { id: 'connect to the internet (1.1.1.1:443)', g: 'network', expect: 'deny', op: 'tcp', host: '1.1.1.1', port: 443 },
    { id: 'look up a name (example.com)', g: 'network', expect: 'deny', op: 'dns', host: 'example.com' },
    { id: 'fetch https://example.com', g: 'network', expect: 'deny', op: 'fetch', url: 'https://example.com/' },
    { id: 'ask a name server over UDP and get an answer (8.8.8.8:53)', g: 'network', expect: 'deny', op: 'udpAsk', host: '8.8.8.8', port: 53 },
    { id: 'send a UDP packet to this computer (127.0.0.1)', g: 'network', expect: 'info', op: 'udp', host: '127.0.0.1', port: udpPort },
    { id: 'connect to a server on this computer (127.0.0.1)', g: 'network', expect: 'deny', op: 'tcp', host: '127.0.0.1', port },
    { id: 'the same by name (localhost)', g: 'network', expect: 'deny', op: 'tcp', host: 'localhost', port },
    { id: 'connect to the helper\'s pipe', g: 'network', expect: 'deny', op: 'pipe', name: pipeName },
    { id: 'listen on 127.0.0.1', g: 'network', expect: 'info', op: 'listen' },
    // others: other programs
    { id: 'read another program\'s command line (PowerShell, WMI)', g: 'others', expect: 'info', direct: `"${PSEXE}" -NoLogo -NoProfile -NonInteractive -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${other.pid}').CommandLine"`, through: (r) => r.stdout.includes(`${CANARY}-argv`) },
    { id: 'the same with wmic', g: 'others', expect: 'info', direct: `"${sys('wbem\\WMIC.exe')}" process where ProcessId=${other.pid} get CommandLine`, through: (r) => r.stdout.includes(`${CANARY}-argv`) },
    { id: 'list programs (tasklist /v)', g: 'others', expect: 'info', direct: `"${sys('tasklist.exe')}" /FI "PID eq ${other.pid}" /V /FO CSV`, through: (r) => r.status === 0 && r.stdout.includes(String(other.pid)) },
    { id: 'signal another program (kill 0)', g: 'others', expect: 'info', op: 'kill', pid: other.pid },
    { id: 'read the clipboard (a small program of its own)', g: 'others', expect: 'deny', direct: `"${spy}" clip`, through: (r) => r.stdout.includes(CANARY) },
    { id: 'the same, without the job (the AppContainer alone)', g: 'others', expect: 'info', job: false, direct: `"${spy}" clip`, through: (r) => r.stdout.includes(CANARY) },
    { id: 'read another program\'s command line (Windows\' own calls)', g: 'others', expect: 'deny', direct: `"${spy}" cmdline ${other.pid}`, through: (r) => r.stdout.includes(`${CANARY}-argv`) },
    { id: 'open another program to read its memory (its environment)', g: 'others', expect: 'deny', direct: `"${spy}" open ${other.pid}`, through: (r) => /OPENED-FOR-READ/.test(r.stdout) },
    // children and shells (last: a child that never ends costs its time-out)
    { id: 'start a child, its output through a pipe (cmd /c echo)', g: 'children', expect: 'info', op: 'exec', file: sys('cmd.exe'), args: ['/d', '/c', 'echo', 'child-ok'] },
    { id: 'start a child, its output nowhere', g: 'children', expect: 'info', op: 'exec', file: sys('cmd.exe'), args: ['/d', '/c', 'echo', 'child-ok'], opts: { stdio: 'ignore' } },
    { id: 'start a child, sharing this program\'s output', g: 'children', expect: 'info', op: 'exec', file: sys('cmd.exe'), args: ['/d', '/c', 'echo', 'child-shares-output-ok'], opts: { stdio: ['ignore', 'inherit', 'inherit'] } },
    { id: 'run TRIF\'s CLI as a child (trif help)', g: 'children', expect: 'info', op: 'exec', file: node, args: ['--preserve-symlinks', '--preserve-symlinks-main', path.join(app, 'helper', 'cli.js'), 'help'], keep: 80 },
    { id: 'Git Bash starts (bash -c echo)', g: 'shells', expect: 'info', direct: '"C:\\Program Files\\Git\\bin\\bash.exe" -c "echo bash-ok; ls / | head -3"', through: (r) => r.stdout.includes('bash-ok') },
    { id: 'Git\'s sh.exe (usr\\bin)', g: 'shells', expect: 'info', direct: '"C:\\Program Files\\Git\\usr\\bin\\sh.exe" -c "echo sh-ok"', through: (r) => r.stdout.includes('sh-ok') },
    { id: 'Git\'s ls.exe alone', g: 'shells', expect: 'info', direct: '"C:\\Program Files\\Git\\usr\\bin\\ls.exe" C:\\Windows\\System32\\drivers\\etc', through: (r) => r.status === 0 && /hosts/.test(r.stdout) },
    { id: 'Windows PowerShell starts', g: 'shells', expect: 'info', direct: `"${PSEXE}" -NoLogo -NoProfile -NonInteractive -Command "Write-Output ps-ok"`, through: (r) => r.stdout.includes('ps-ok') },
    { id: 'cmd.exe starts', g: 'shells', expect: 'info', direct: `"${sys('cmd.exe')}" /d /c echo cmd-ok`, through: (r) => r.stdout.includes('cmd-ok') },
    { id: 'cmd.exe starts a child of its own (cmd /c cmd /c echo)', g: 'shells', expect: 'info', direct: `"${sys('cmd.exe')}" /d /c "${sys('cmd.exe')}" /d /c echo grandchild-ok`, through: (r) => r.stdout.includes('grandchild-ok') },
    { id: 'node starts a child (cmd /c echo), in the job', g: 'shells', expect: 'info', direct: `"${node}" -e "const r=require('child_process').spawnSync(process.env.ComSpec,['/d','/c','echo','node-child-ok'],{encoding:'utf8',timeout:8000});console.log(r.status,r.stdout,r.error&&r.error.code)"`, through: (r) => r.stdout.includes('node-child-ok') },
    { id: 'node starts a child, without the job', g: 'shells', expect: 'info', job: false, direct: `"${node}" -e "const r=require('child_process').spawnSync(process.env.ComSpec,['/d','/c','echo','node-child-ok'],{encoding:'utf8',timeout:8000});console.log(r.status,r.stdout,r.error&&r.error.code)"`, through: (r) => r.stdout.includes('node-child-ok') },
    { id: 'cmd.exe starts a child, without the job', g: 'shells', expect: 'info', job: false, direct: `"${sys('cmd.exe')}" /d /c "${sys('cmd.exe')}" /d /c echo grandchild-ok`, through: (r) => r.stdout.includes('grandchild-ok') },
    { id: 'trif.cmd-like: cmd.exe starts node with a script', g: 'shells', expect: 'info', direct: `"${sys('cmd.exe')}" /d /c ""${node}" --preserve-symlinks --preserve-symlinks-main "${path.join(app, 'fence-test', 'hello.js')}""`, through: (r) => r.stdout.includes('script-ok') },
    { id: 'TRIF\'s CLI (trif help)', g: 'shells', expect: 'allow', direct: `"${node}" --preserve-symlinks --preserve-symlinks-main "${path.join(app, 'helper', 'cli.js')}" help`, through: (r) => r.status === 0 && /trif/i.test(r.stdout) },
    { id: 'node from C:\\Program Files\\nodejs starts', g: 'shells', expect: 'info', direct: '"C:\\Program Files\\nodejs\\node.exe" -p process.version', through: (r) => r.status === 0 && /^v\d/.test(r.stdout.trim()) },
    { id: 'the environment it has', g: 'shells', expect: 'info', op: 'env' },
    { id: 'who it is (whoami /groups)', g: 'shells', expect: 'info', direct: `"${sys('whoami.exe')}" /groups /fo csv /nh`, through: (r) => r.status === 0, long: true },
  ];
  // (a process the command leaves behind: the job ends it)
  const leftPid = path.join(box, 'left.pid');
  ops.push({ id: 'leave a process behind', g: 'others', expect: 'info', op: 'exec', file: node, args: ['-e', `const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' }); c.unref(); require('fs').writeFileSync(${JSON.stringify(leftPid)}, String(c.pid));`] });
  const cfgFile = path.join(box, 'probe.json');
  const outFile = path.join(box, 'probe-out.json');
  // (`direct`: a command started by the fence itself, one launch each, judged from here by `through`;
  // the rest are tried by probe.js, one process inside the fence)
  fs.writeFileSync(cfgFile, JSON.stringify({ ops: ops.filter((o) => !o.direct), out: outFile }));

  const envInside = {
    SystemRoot: SYSROOT, SystemDrive: process.env.SystemDrive || 'C:', windir: SYSROOT, ComSpec: sys('cmd.exe'),
    PATHEXT: '.COM;.EXE;.BAT;.CMD', PATH: `${nodeDir};${path.join(SYSROOT, 'System32')}`,
    TEMP: path.join(box, 'tmp'), TMP: path.join(box, 'tmp'), USERPROFILE: stage, APPDATA: path.join(box, 'tmp'), LOCALAPPDATA: path.join(box, 'tmp'),
    TRIF_RUN_BOX: box,
  };
  // Folders on the way to what the run may read, inside the profile folder (the user's own to change):
  // "read attributes" alone, for programs that look at every folder on a path (node, for a script's real path).
  const onTheWay = () => {
    const stop = path.resolve(os.homedir(), '..').toLowerCase();
    const set = new Set();
    for (const p of [app, nodeDir, stage, box, shots]) {
      for (let d = path.dirname(p); d.toLowerCase() !== stop && d.toLowerCase().startsWith(stop) && path.dirname(d) !== d; d = path.dirname(d)) set.add(d);
    }
    return [...set];
  };
  const specFor = (mode, { stat = false, flags = [], command = null, name = `trif.run.${rand()}`, revoke = true } = {}) => ({
    // (a capability name per mode and for the "on the way" entries, which stay: so each try starts clean)
    name, capability: `trifRunCode.${mode}${stat ? '.stat' : ''}`, lpac: mode !== 'appcontainer', revoke, cwd: stage, env: envInside,
    ...(mode === 'lpac+registryRead' ? { capabilities: ['registryRead'] } : {}),
    grant: [
      { path: app, rights: 'r', to: 'capability' },
      { path: nodeDir, rights: 'r', to: 'capability' },
      { path: stage, rights: 'r' },
      // sites/: folders may be made in it (a new site's); what's inside is the run's to change...
      { path: path.join(stage, 'sites'), rights: 'r+mkdir', inherit: false },
      { path: path.join(stage, 'sites'), rights: 'rw', inherit: 'only' },
      { path: box, rights: 'rw' },
      { path: shots, rights: 'rw' },
      ...(stat ? onTheWay().map((p) => ({ path: p, rights: 'stat', to: 'capability' })) : []),
    ],
    // ...but for the folders of other sites that are there when it starts: read only
    readonly: [path.join(stage, 'sites', 'y.com')],
    command: command || `"${node}" ${flags.join(' ')} "${probe}" "${cfgFile}"`,
  });

  const results = {};
  for (const mode of ['appcontainer', 'lpac', 'lpac+registryRead']) {
    console.log(`\n================ ${mode === 'appcontainer' ? 'AppContainer' : mode === 'lpac' ? 'less-privileged AppContainer (lpac)' : 'lpac with Windows\' registryRead capability'}`);
    fs.rmSync(outFile, { force: true });
    // How node has to be started for a script inside the profile folder to load.
    const hello = fence(exe, specFor(mode, { command: `"${node}" -p "'node-ok ' + process.version"` }));
    console.log(`node -p inside: ${hello.status === 0 ? hello.stdout.trim() : `FAILED status ${hello.status} ${hello.stderr.trim().slice(0, 300)}`} (${hello.ms} ms)`);
    let how = null;
    for (const v of [{ label: 'as it is', flags: [], stat: false }, { label: 'with --preserve-symlinks --preserve-symlinks-main', flags: ['--preserve-symlinks', '--preserve-symlinks-main'], stat: false }]) {
      const r = fence(exe, specFor(mode, { ...v, command: `"${node}" ${v.flags.join(' ')} "${path.join(app, 'fence-test', 'hello.js')}"` }));
      const ok = r.status === 0 && r.stdout.includes('script-ok');
      console.log(`a script in the profile folder, ${v.label}: ${ok ? 'runs' : `doesn't (${(r.stderr.trim().split(/\r?\n/).find((l) => /Error|EPERM|EACCES/.test(l)) || r.stderr.trim().slice(0, 200) || `exit ${r.status}`)})`} (${r.ms} ms)`);
      if (ok && !how) how = v;
    }
    if (!how) {
      if (mode === 'lpac') console.log('info  node doesn\'t start in an lpac without registryRead (Winsock can\'t read its settings): not a candidate');
      else { console.log('FAIL  node can\'t run a script inside the fence at all'); failed++; }
      continue;
    }
    console.log(`using: ${how.label}`);
    const name = `trif.run.${rand()}`;
    const r = fence(exe, specFor(mode, { ...how, name, revoke: false }));
    const m = /FENCE-PROBE (\{.*\})/.exec(r.stdout);
    let got = null;
    if (m) got = JSON.parse(m[1]);
    else {
      console.log(`FAIL  the probe didn't finish: status ${r.status} ${r.error ? r.error.message : ''}\n${r.stdout.slice(-1500)}\n${r.stderr.slice(-1500)}`);
      failed++;
      try { got = JSON.parse(fs.readFileSync(outFile, 'utf8')); console.log('(what it got to before that:)'); } catch { continue; }
    }
    results[mode] = got;
    for (const o of ops.filter((x) => x.direct)) {
      const d = fence(exe, { ...specFor(mode, { ...how, name, revoke: false, command: o.direct }), ...(o.job === false ? { job: false } : {}) }, { timeout: 40000 });
      const hung = d.status === null;
      let through = false;
      try { through = !hung && !!o.through(d); } catch { /* not through */ }
      got[o.id] = { ok: through, got: d.stdout.trim(), why: hung ? 'never ended (40 s)' : `${d.stdout.trim().replace(CANARY, 'CANARY').slice(0, 90)} ${d.stderr.trim().split(/\r?\n/)[0] || ''} (exit ${d.status})`, ms: d.ms, hung };
    }
    console.log(`the probe ran in ${r.ms} ms\n`);
    let group = '';
    for (const o of ops) {
      const res = got[o.id];
      if (!res) { if (o.g !== group) { group = o.g; console.log(`  [${group}]`); } console.log(`  ${o.expect === 'info' ? 'info' : 'FAIL'} NOT TRIED    ${o.id}`); if (o.expect !== 'info') failed++; continue; }
      const through = !!res.ok;
      const verdict = o.expect === 'info' ? 'info' : (o.expect === 'allow') === through ? 'PASS' : 'FAIL';
      if (verdict === 'FAIL') failed++;
      if (o.g !== group) { group = o.g; console.log(`  [${group}]`); }
      const detail = through ? (res.got !== undefined ? String(res.got).replace(/\s+/g, ' ').slice(0, o.op === 'env' || o.long ? 1800 : 110) : '') : String(res.why || '').replace(/\s+/g, ' ').slice(0, 140);
      console.log(`  ${verdict.padEnd(4)} ${through ? 'got through' : 'refused    '}  ${o.id}${detail ? `  — ${detail}` : ''}${res.ms > 3000 ? `  (${res.ms} ms)` : ''}`);
      if (through && typeof res.got === 'string' && res.got.includes(CANARY) && o.expect === 'deny') console.log('        (the canary came back)');
    }
    // From outside: nothing it shouldn't have changed did, the servers saw nobody, nothing was left running.
    const check = (ok, what) => { let v = false; try { v = typeof ok === 'function' ? !!ok() : !!ok; } catch { /* not so */ } console.log(`  ${v ? 'PASS' : 'FAIL'} (outside)  ${what}`); if (!v) failed++; };
    check(() => fs.readFileSync(path.join(stage, 'sites', 'y.com', 'other.js'), 'utf8') === '// other' && fs.existsSync(path.join(stage, 'sites', 'y.com', 'keep.js')) && !fs.existsSync(path.join(stage, 'sites', 'y.com', 'planted.js')), 'another site\'s folder is as it was');
    check(() => fs.readFileSync(path.join(stage, 'AGENTS.md'), 'utf8') === '# guide' && !fs.existsSync(path.join(stage, 'CLAUDE.md')), 'the guides are as they were');
    check(() => fs.readFileSync(path.join(live, 'allowed.json'), 'utf8') === '{}' && !fs.existsSync(path.join(live, 'sites', 'x.com', 'planted.js')), 'the live workspace is as it was');
    check(!fs.existsSync(path.join(priv, 'planted.json')) && !fs.existsSync(path.join(home, 'planted.txt')) && !fs.existsSync(path.join(boxes, 'r2', 'forged.json')), 'nothing planted in the private folder, the home folder or another run\'s mailbox');
    check(fs.existsSync(path.join(stage, 'sites', 'x.com', 'new.js')) && fs.existsSync(path.join(box, 'req-1.json')) && fs.existsSync(path.join(shots, 'a.png')), 'its own mod, mailbox request and screenshot are there');
    // (a moment first: while the fence ran, this program was waiting on it and took no connections; any
    // that came are taken now)
    await new Promise((res) => setTimeout(res, 500));
    check(tcpHits === 0 && pipeHits === 0 && udpHits === 0, `the servers and the pipe on this computer heard nothing (tcp ${tcpHits}, udp ${udpHits}, pipe ${pipeHits})`);
    let left = null;
    try { left = Number(fs.readFileSync(leftPid, 'utf8')); } catch { /* it couldn't start one */ }
    if (left) {
      let alive = true;
      for (let i = 0; i < 20 && alive; i++) { try { process.kill(left, 0); await new Promise((res) => setTimeout(res, 100)); } catch { alive = false; } }
      check(!alive, `the process it left behind (pid ${left}) ended with the command`);
    } else console.log('  info (outside)  it couldn\'t leave a process behind');
    // (a last launch with `revoke`: the run's entries leave its folders and its profile is deleted)
    const sid = String(spawnSync(exe, ['sid', name], { encoding: 'utf8' }).stdout || '').trim();
    const sddl = () => String(spawnSync(PSEXE, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `(Get-Acl -LiteralPath '${stage}').Sddl; (Get-Acl -LiteralPath '${path.join(stage, 'sites')}').Sddl`], { encoding: 'utf8' }).stdout || '');
    const before = sddl();
    const last = fence(exe, specFor(mode, { ...how, name, revoke: true, command: `"${node}" -p 1` }), { timeout: 40000 });
    const acl = sddl();
    check(!!sid && before.includes(sid), `while it runs, its working folder's access list names the run (${sid.slice(0, 24)}…)`);
    check(!!sid && !acl.includes(sid), 'afterwards its entries are gone from its working folder');
    if (!before.includes(sid) || acl.includes(sid)) console.log(`        last launch: exit ${last.status} ${last.stderr.trim().slice(0, 300)}\n        before: ${before.trim().slice(0, 700)}\n        after:  ${acl.trim().slice(0, 700)}`);
    spawnSync(sys('reg.exe'), ['delete', REG_KEY, '/v', 'fromInside', '/f']);
    // (put back what the allowed writes changed, for the next mode)
    for (const f of [path.join(stage, 'sites', 'x.com', 'new.js'), path.join(box, 'req-1.json'), path.join(box, 'tmp', 't.txt'), path.join(shots, 'a.png'), leftPid, path.join(box, 'hl'), path.join(box, 'sl')]) fs.rmSync(f, { force: true });
    for (const d of [path.join(stage, 'sites', 'new.org'), path.join(box, 'j')]) { try { fs.rmdirSync(d); } catch { /* not made */ } }
    for (const [n, t] of [['other.js', '// other'], ['keep.js', '// keep']]) { try { put(path.join(stage, 'sites', 'y.com', n), t); } catch { /* as it is */ } }
    fs.rmSync(path.join(stage, 'sites', 'y.com', 'planted.js'), { force: true });
    fs.rmSync(path.join(stage, 'sites', 'x.com', 'stolen'), { recursive: true, force: true });
    fs.writeFileSync(path.join(stage, 'sites', 'x.com', 'own.js'), '// own');
    fs.writeFileSync(path.join(stage, 'sites', 'all-sites', 'dark.js'), '// all');
    tcpHits = 0; pipeHits = 0; udpHits = 0;
  }

  // ---- tidy up
  other.kill();
  server.close();
  udpServer.close();
  pipeServer.close();
  spawnSync(sys('reg.exe'), ['delete', REG_KEY, '/f']);
  fs.rmSync(profileCanary, { force: true });
  try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* left in the temp folder */ }
  console.log(`\n${failed ? `${failed} attempt(s) went the wrong way` : 'every guarantee held, and everything a run needs worked'}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

'use strict';
// The phone link on Windows (11-23, Tim: on, with Windows' own DNS-SD and the firewall's own prompt): the
// announcer's program and arguments (helper/lib/phonelink/bonjour.js, helper/lib/win/dnssd.js), ended by
// closing its input; and doctor's firewall line (helper/lib/win/firewall.js). Stand-ins only, on every system:
// a .js for trif-dnssd.exe (tests/fake-dns-sd.js), a fake csc.exe, a fake PowerShell (tests/fake-powershell.js).
// Nothing is announced and no firewall is read. The real program on windows-latest: windows.yml's DNS-SD step.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { tempDir, waitFor } = require('./fake-extension');
const { makeStandIn } = require('./fake-dns-sd');
const { makeFakePowerShell } = require('./fake-powershell');
const { Announcer, recordArgs } = require('../helper/lib/phonelink/bonjour');
const dnssd = require('../helper/lib/win/dnssd');
const firewall = require('../helper/lib/win/firewall');

const ID = '0123456789abcdef';
const gone = (pid) => { try { process.kill(pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; } };

/** A store and a listener as the announcer sees them: the store's name and key id, the listener's port. */
function fakes(name = 'Study PC') {
  const store = Object.assign(new EventEmitter(), { name, status: () => ({ id: ID }) });
  const server = Object.assign(new EventEmitter(), { port: 0, address() { return this.port ? { port: this.port } : null; } });
  const listen = (port) => { server.port = port; server.emit(port ? 'listening' : 'stopped'); };
  return { store, server, listen };
}

test('Windows announcer: trif-dnssd with dns-sd\'s own arguments while the link listens, ended by closing its input', async () => {
  const standIn = makeStandIn(path.join(tempDir('wm-dnssd-'), 'bin'), { windows: true });
  const { store, server, listen } = fakes();
  const lines = [];
  const a = new Announcer(store, server, { env: { TRIF_DNS_SD: standIn.bin }, platform: 'win32', log: (l) => lines.push(l), retryMs: 20, retryMaxMs: 80 });
  a.start();
  assert.equal(standIn.calls().length, 0, 'nothing while nothing listens');
  assert.equal(a.status().error, null, 'Windows is supported');
  listen(4321);
  const first = await waitFor(() => standIn.calls()[0], { message: 'the announcer to start' });
  assert.deepEqual(first.argv, ['-R', 'Study PC', '_trif._tcp', 'local', '4321', 'v=1', `id=${ID}`]);
  assert.deepEqual(first.argv, recordArgs({ name: 'Study PC', port: 4321, id: ID }), 'the Mac\'s record, unchanged');
  await waitFor(() => a.status().running, { message: 'running' });
  // the listener gone: the record is taken back (its input closed), never by killing it
  listen(0);
  await waitFor(() => standIn.calls().some((c) => c.pid === first.pid && c.ended === 'stdin'), { message: 'the child to see its input close' });
  await waitFor(() => gone(first.pid), { message: 'the child to end' });
  // a new port, a new record; stop() ends it the same way
  listen(5555);
  const second = await waitFor(() => standIn.calls().find((c) => c.argv && c.argv[4] === '5555'), { message: 'a new record' });
  a.stop();
  await waitFor(() => standIn.calls().some((c) => c.pid === second.pid && c.ended === 'stdin'), { message: 'stop() to close its input' });
  // one that exits at once (Windows refused the registration) is started again after a pause
  standIn.die(true);
  const b = new Announcer(store, server, { env: { TRIF_DNS_SD: standIn.bin }, platform: 'win32', log: () => {}, retryMs: 20, retryMaxMs: 80 });
  b.start();
  await waitFor(() => b.status().error === 'failing', { message: 'failing' });
  const n = standIn.calls().length;
  await waitFor(() => standIn.calls().length > n, { message: 'a retry' });
  b.stop();
  standIn.die(false);
});

test('Windows announcer: no C# compiler, so no trif-dnssd.exe: said once ("missing"), nothing started', async () => {
  const root = tempDir('wm-dnssd-');
  const { store, server, listen } = fakes();
  const lines = [];
  // (a Windows folder with no .NET in it: never the runner's real csc.exe, which would build and announce)
  const a = new Announcer(store, server, { env: { SystemRoot: path.join(root, 'nowindows') }, platform: 'win32', binDir: path.join(root, 'bin'), log: (l) => lines.push(l) });
  a.start();
  listen(4321);
  assert.equal(a.status().error, 'missing');
  assert.equal(a.status().running, false);
  assert.match(lines.join('\n'), /can't announce, the announcer didn't start \(Windows' C# compiler .* isn't on this computer, so TRIF can't build its announcer\)/);
  assert.equal(fs.existsSync(path.join(root, 'bin')) && fs.readdirSync(path.join(root, 'bin')).length, false);
  a.stop();
  // (elsewhere than the Mac and Windows: unsupported, as before)
  assert.equal(new Announcer(store, server, { platform: 'linux' }).status().error, 'unsupported');
});

test('trif-dnssd.exe: built once per version of dnssd.cs by Windows\' csc.exe, into the bin folder; older versions removed', () => {
  const root = tempDir('wm-dnssd-');
  const csc = path.join(root, 'csc.exe');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'trif-dnssd-aaaaaaaaaaaa.exe'), 'old');
  const calls = [];
  const run = (file, args) => {
    calls.push({ file, args });
    const out = args.find((x) => x.startsWith('/out:')).slice(5);
    fs.writeFileSync(out, 'MZ');
    return { status: 0, stdout: '', stderr: '' };
  };
  const p = dnssd.program(bin, { csc, run });
  assert.equal(p.error, null);
  assert.equal(p.file, dnssd.programFile(bin));
  assert.match(path.basename(p.file), /^trif-dnssd-[0-9a-f]{12}\.exe$/);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.filter((x) => !x.startsWith('/out:')), ['/nologo', '/o+', dnssd.SOURCE]);
  assert.ok(!fs.existsSync(path.join(bin, 'trif-dnssd-aaaaaaaaaaaa.exe')), 'the old version went');
  // there already: not built again
  assert.equal(dnssd.program(bin, { csc, run }).file, p.file);
  assert.equal(calls.length, 1);
  // a compiler that fails: said why, nothing left
  fs.rmSync(p.file);
  const bad = dnssd.program(bin, { csc, run: () => ({ status: 1, stdout: 'dnssd.cs(1,1): error CS1002: ; expected', stderr: '' }) });
  assert.equal(bad.file, null);
  assert.match(bad.error, /couldn't build TRIF's announcer: dnssd\.cs\(1,1\): error CS1002/);
  assert.deepEqual(fs.readdirSync(bin), []);
  // the source: Windows' own API, the Mac's arguments, held until its input closes
  const src = fs.readFileSync(dnssd.SOURCE, 'utf8');
  for (const s of ['DnsServiceRegister', 'DnsServiceDeRegister', 'DnsServiceConstructInstance', 'Console.In.ReadLine()', '"-R"', '"-B"']) assert.ok(src.includes(s), s);
});

test('Windows Firewall for the phone link: what the rules for node.exe and the networks the computer is on say', () => {
  const v = firewall.verdict;
  assert.deepEqual(v({ rules: [], networks: ['Private'] }), { state: 'unasked', networks: ['Private'] });
  assert.deepEqual(v({ rules: [{ action: 'Allow', profile: 'Private' }], networks: ['Private'] }), { state: 'allowed', networks: ['Private'] });
  assert.deepEqual(v({ rules: [{ action: 'Allow', profile: 'Any' }], networks: ['Public', 'DomainAuthenticated'] }).state, 'allowed');
  assert.deepEqual(v({ rules: [{ action: 'Allow', profile: 'Private' }], networks: ['Public'] }), { state: 'elsewhere', networks: ['Public'] });
  // (a cancelled prompt leaves Block rules; a Block wins over an Allow for the same profile)
  assert.deepEqual(v({ rules: [{ action: 'Block', profile: 'Private, Public' }, { action: 'Allow', profile: 'Private' }], networks: ['Private'] }), { state: 'blocked', networks: ['Private'] });
  assert.deepEqual(v({ rules: [{ action: 'Allow', profile: 'Domain, Private' }], networks: [] }), { state: 'offline', networks: [] });
  // (PowerShell's ConvertTo-Json gives one rule as an object, not a list)
  assert.equal(v({ rules: { action: 'Allow', profile: 'Private' }, networks: 'Private' }).state, 'allowed');
  // doctor's lines
  const line = (x) => firewall.doctorCheck(v(x));
  assert.deepEqual(line({ rules: [{ action: 'Allow', profile: 'Private' }], networks: ['Private'] }), { status: 'ok', title: 'phone link: Windows Firewall lets a phone reach this computer (Node.js is allowed on private networks)' });
  const blocked = line({ rules: [{ action: 'Block', profile: 'Any' }], networks: ['Private'] });
  assert.equal(blocked.status, 'warn');
  assert.equal(blocked.title, 'phone link: Windows Firewall blocks Node.js on this private network, so a phone can\'t reach this computer');
  assert.match(blocked.fix, /Allow an app through firewall/);
  assert.equal(line({ rules: [{ action: 'Allow', profile: 'Private' }], networks: ['Public'] }).title, 'phone link: Windows Firewall lets Node.js in on other networks, not this public one, so a phone can\'t reach this computer here');
  assert.deepEqual(line({ rules: [], networks: ['Private'] }), { status: 'info', title: 'phone link: Windows will ask whether Node.js can use the network the first time you connect a phone: allow it on private networks' });
  assert.equal(firewall.doctorCheck({ state: 'unknown', error: 'no NetSecurity module' }).title, 'phone link: couldn\'t read Windows Firewall\'s rules for Node.js (no NetSecurity module)');
});

test('Windows Firewall for the phone link: read through PowerShell, for the helper\'s own node.exe; read only', () => {
  const ps = makeFakePowerShell(path.join(tempDir('wm-fw-'), 'ps'));
  ps.setFirewall({ rules: [{ action: 'Allow', profile: 'Private' }], networks: ['Private'] });
  const node = 'C:\\Program Files\\nodejs\\node.exe';
  const r = firewall.check(node, { bin: ps.bin });
  assert.deepEqual(r, { state: 'allowed', networks: ['Private'] });
  assert.deepEqual(ps.firewallAsked(), [node]);
  assert.ok(!/New-NetFirewallRule|Set-NetFirewall|Remove-NetFirewall|netsh/i.test(firewall.SCRIPT), 'never changes a rule');
  ps.fail('Get-NetFirewallApplicationFilter : Access denied');
  assert.deepEqual(firewall.check(node, { bin: ps.bin }), { state: 'unknown', error: 'Get-NetFirewallApplicationFilter : Access denied' });
});

test('trif doctor on Windows: the firewall line while the phone link is on, none while it\'s off', { skip: process.platform !== 'win32' && 'doctor reads the firewall on Windows only' }, async () => {
  const { runCli, privDir } = require('./fake-extension');
  const home = tempDir('wm-fwd-');
  const ps = makeFakePowerShell(path.join(tempDir('wm-fw-'), 'ps'));
  let r = await runCli(['doctor'], { home, env: { TRIF_POWERSHELL_BIN: ps.bin } });
  assert.doesNotMatch(r.stdout, /phone link: /);
  assert.deepEqual(ps.firewallAsked(), [], 'not read while the link is off');
  fs.mkdirSync(privDir(home), { recursive: true });
  fs.writeFileSync(path.join(privDir(home), 'phone-link.json'), JSON.stringify({ on: true, publicKey: Buffer.alloc(32, 7).toString('base64url'), phones: [] }));
  ps.setFirewall({ rules: [{ action: 'Allow', profile: 'Private' }], networks: ['Private'] });
  r = await runCli(['doctor'], { home, env: { TRIF_POWERSHELL_BIN: ps.bin } });
  assert.match(r.stdout, /^ok {4}phone link: Windows Firewall lets a phone reach this computer \(Node\.js is allowed on private networks\)$/m);
  assert.equal(ps.firewallAsked().length, 1);
  ps.setFirewall({ rules: [{ action: 'Block', profile: 'Any' }], networks: ['Private'] });
  r = await runCli(['doctor'], { home, env: { TRIF_POWERSHELL_BIN: ps.bin } });
  assert.match(r.stdout, /^warn {2}phone link: Windows Firewall blocks Node\.js on this private network/m);
  assert.match(r.stdout, /fix: in Windows Security, Firewall & network protection, "Allow an app through firewall"/);
});

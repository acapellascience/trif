'use strict';
// windows-latest only (windows.yml): the phone link's real announcer on Windows. The announcer
// (helper/lib/phonelink/bonjour.js) builds trif-dnssd.exe with Windows' csc.exe (helper/lib/win/dnssd.js) and
// registers the Mac's record through Windows' DNS-SD API; the same program's -B browses for it, as a phone
// would ask. Then the record is taken back by closing the program's input. Prints PASS/FAIL lines; exit 1 on a
// failure. Never run on a person's computer: it announces on the network it's on (a CI runner's).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { EventEmitter } = require('events');
const { Announcer } = require('../helper/lib/phonelink/bonjour');

if (process.platform !== 'win32') { console.log('windows only'); process.exit(0); }

let failed = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `: ${detail}` : ''}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-dnssd-'));
  const name = `TRIF CI ${process.pid}`;
  const store = Object.assign(new EventEmitter(), { name, status: () => ({ id: '0123456789abcdef' }) });
  const server = Object.assign(new EventEmitter(), { port: 0, address() { return this.port ? { port: this.port } : null; } });
  const lines = [];
  const a = new Announcer(store, server, { platform: 'win32', binDir: bin, env: process.env, log: (l) => { lines.push(l); console.log(`  | ${l}`); } });
  a.start();
  const t0 = Date.now();
  server.port = 45678;
  server.emit('listening');
  const built = fs.readdirSync(bin).find((n) => /^trif-dnssd-[0-9a-f]{12}\.exe$/.test(n));
  check(!!built, 'trif-dnssd.exe built by csc.exe', built ? `${Date.now() - t0} ms` : lines.join(' '));
  if (!built) process.exit(1);
  for (let i = 0; i < 50 && !a.status().running; i++) await sleep(100);
  check(a.status().running, 'the announcer is running', JSON.stringify(a.status()));
  await sleep(1500); // (the registration's answer; the program exits 3 if Windows refused it)
  check(a.status().running && a.status().error === null, 'Windows took the registration (the program is still up)', JSON.stringify(a.status()));

  const exe = path.join(bin, built);
  const browse = () => spawnSync(exe, ['-B', '_trif._tcp', 'local', '6'], { encoding: 'utf8', timeout: 20000 });
  const r = browse();
  console.log(`  | -B exit ${r.status}; stdout: ${JSON.stringify(r.stdout)}; stderr: ${JSON.stringify(r.stderr)}`);
  check(r.status === 0, 'browsing works');
  const found = String(r.stdout).split(/\r?\n/).some((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}._trif._tcp.local`));
  check(found, `the record is found by browsing (${name}._trif._tcp.local)`);

  // Taken back: the input closed, the program deregisters and exits 0.
  const child = a.child;
  const exited = new Promise((res) => child.once('exit', (code) => res(code)));
  server.port = 0;
  server.emit('stopped');
  const code = await Promise.race([exited, sleep(10000).then(() => 'still running')]);
  check(code === 0, 'closing its input takes the record back and ends it (exit 0)', String(code));
  a.stop();
  const after = browse();
  console.log(`  | (information) browsing after: ${JSON.stringify(after.stdout)}`);
  // (information) Windows Firewall as doctor reads it, for this node.exe: the runner has no rule for it
  const fw = require('../helper/lib/win/firewall');
  const v = fw.check(process.execPath);
  console.log(`  | (information) Windows Firewall for ${process.execPath}: ${JSON.stringify(v)}; doctor: ${JSON.stringify(fw.doctorCheck(v))}`);
  console.log(failed ? `${failed} checks failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL  ${e.stack}`); process.exit(1); });

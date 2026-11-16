'use strict';
// Runs INSIDE the fence (tests/windows-fence/run.js starts it there): tries each thing a side-panel run's
// commands must and must not be able to do, and prints what happened as one JSON object. `node probe.js
// <config.json>`; the config ({ops: [{id, op, ...}]}) is written by run.js.

const fs = require('fs');
const net = require('net');
const dns = require('dns');
const dgram = require('dgram');
const path = require('path');
const { spawn } = require('child_process');

const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = {};
const short = (e) => (e && (e.code || e.message) ? String(e.code || e.message).slice(0, 160) : String(e).slice(0, 160));
const sys = (name) => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', name);

function connect(target, ms = 4000) {
  return new Promise((resolve) => {
    const s = net.connect(target);
    const done = (r) => { try { s.destroy(); } catch { /* gone */ } resolve(r); };
    s.setTimeout(ms, () => done({ ok: false, why: 'timeout' }));
    s.on('connect', () => { s.write('hello from inside\n'); setTimeout(() => done({ ok: true }), 200); });
    s.on('error', (e) => done({ ok: false, why: short(e) }));
  });
}
// A child, never waited for longer than `timeout`: {status, error, stdout, stderr, hung}. (Not spawnSync:
// a child that never ends, or never starts properly, would stop the whole probe.)
function run(file, args, opts = {}) {
  const { timeout = 12000, stdio = ['ignore', 'pipe', 'pipe'], ...rest } = opts;
  return new Promise((resolve) => {
    let child;
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve({ stdout: stdout.slice(0, 2000), stderr: stderr.slice(0, 600), error: null, status: null, ...r }); };
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } finish({ hung: true, error: `no end within ${timeout} ms` }); }, timeout);
    try { child = spawn(file, args, { windowsHide: true, stdio, ...rest }); } catch (e) { finish({ error: short(e) }); return; }
    if (child.stdout) child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    if (child.stderr) child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
    child.on('error', (e) => finish({ error: short(e) }));
    child.on('exit', (status) => setTimeout(() => finish({ status }), 150)); // (a moment for what it printed)
  });
}

const OPS = {
  read: (o) => ({ ok: true, got: fs.readFileSync(o.path, 'utf8').slice(0, 60) }),
  list: (o) => ({ ok: true, got: fs.readdirSync(o.path).length }),
  stat: (o) => ({ ok: true, got: fs.statSync(o.path).isDirectory() ? 'dir' : 'file' }),
  write: (o) => { fs.writeFileSync(o.path, 'written from inside the fence\n'); return { ok: true }; },
  append: (o) => { fs.appendFileSync(o.path, 'appended from inside the fence\n'); return { ok: true }; },
  mkdir: (o) => { fs.mkdirSync(o.path); return { ok: true }; },
  delete: (o) => { fs.rmSync(o.path, { recursive: true }); return { ok: !fs.existsSync(o.path) }; },
  rename: (o) => { fs.renameSync(o.path, o.to); return { ok: true }; },
  symlink: (o) => { fs.symlinkSync(o.target, o.path); return { ok: true, got: fs.readFileSync(o.path, 'utf8').slice(0, 60) }; },
  hardlink: (o) => { fs.linkSync(o.target, o.path); return { ok: true, got: fs.readFileSync(o.path, 'utf8').slice(0, 60) }; },
  // a junction needs no privilege to make: what counts is reading through it
  junction: (o) => { fs.symlinkSync(o.target, o.path, 'junction'); return { ok: true, made: true, got: fs.readFileSync(path.join(o.path, o.file), 'utf8').slice(0, 60) }; },
  tcp: (o) => connect({ host: o.host, port: o.port }),
  pipe: (o) => connect(o.name),
  dns: (o) => new Promise((resolve) => {
    dns.lookup(o.host, (e, addr) => resolve(e ? { ok: false, why: short(e) } : { ok: true, got: addr }));
    setTimeout(() => resolve({ ok: false, why: 'no answer within 8 s' }), 8000);
  }),
  udp: (o) => new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    s.on('error', (e) => { try { s.close(); } catch { /* closed */ } resolve({ ok: false, why: short(e) }); });
    s.send('x', o.port, o.host, (e) => { try { s.close(); } catch { /* closed */ } resolve(e ? { ok: false, why: short(e) } : { ok: true }); });
  }),
  listen: () => new Promise((resolve) => {
    const s = net.createServer();
    s.on('error', (e) => resolve({ ok: false, why: short(e) }));
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve({ ok: true, got: p })); });
  }),
  fetch: async (o) => { const r = await fetch(o.url, { signal: AbortSignal.timeout(6000) }); return { ok: true, got: r.status }; },
  // a child, which must be in the fence too: `cmd /c type <file>`
  childRead: async (o) => { const r = await run(sys('cmd.exe'), ['/d', '/c', 'type', o.path]); return { ok: r.status === 0 && r.stdout.length > 0, got: r.stdout.slice(0, 60), why: r.error || r.stderr.trim().slice(0, 120) }; },
  exec: async (o) => { const r = await run(o.file, o.args || [], o.opts || {}); return { ok: r.status === 0, got: r.stdout.trim().slice(0, o.keep || 300), why: r.error || r.stderr.trim().slice(0, 300) || `exit ${r.status}` }; },
  kill: (o) => { process.kill(o.pid, 0); return { ok: true }; },
  // another process's command line (a canary is in it), as any same-user program can read it
  cmdline: async (o) => {
    const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const r = await run(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(o.pid)}").CommandLine`]);
    const w = await run(sys('wbem\\WMIC.exe'), ['process', 'where', `ProcessId=${Number(o.pid)}`, 'get', 'CommandLine']);
    const t = await run(sys('tasklist.exe'), ['/FI', `PID eq ${Number(o.pid)}`, '/V', '/FO', 'CSV']);
    const all = `${r.stdout}\n${w.stdout}\n${t.stdout}`;
    return { ok: all.includes(o.canary), got: `powershell: ${r.error || r.status} ${r.stdout.trim().slice(0, 80)} | wmic: ${w.error || w.status} | tasklist: ${t.error || t.status} ${t.stdout.trim().slice(0, 120)}`, why: (r.stderr || w.stderr || t.stderr).trim().slice(0, 200) };
  },
  regRead: async (o) => { const r = await run(sys('reg.exe'), ['query', o.key, ...(o.value ? ['/v', o.value] : ['/ve'])]); return { ok: r.status === 0, got: r.stdout.trim().replace(/\s+/g, ' ').slice(0, 160), why: r.error || r.stderr.trim().slice(0, 120) }; },
  regWrite: async (o) => { const r = await run(sys('reg.exe'), ['add', o.key, '/v', 'fromInside', '/t', 'REG_SZ', '/d', 'x', '/f']); return { ok: r.status === 0, why: r.error || r.stderr.trim().slice(0, 120) }; },
  clipboard: async () => {
    const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const r = await run(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::GetText()']);
    return { ok: r.status === 0 && r.stdout.trim().length > 0, got: r.stdout.trim().slice(0, 60), why: r.error || r.stderr.trim().slice(0, 160) || `exit ${r.status}` };
  },
  env: () => ({ ok: true, got: Object.keys(process.env).sort().join(',').slice(0, 1500) }),
  whoami: async () => { const r = await run(sys('whoami.exe'), ['/groups', '/fo', 'csv', '/nh']); return { ok: r.status === 0, got: r.stdout.replace(/\r?\n/g, ' ; ').slice(0, 1800), why: r.error || r.stderr.slice(0, 200) }; },
};

(async () => {
  for (const o of cfg.ops) {
    const t = Date.now();
    try { out[o.id] = await OPS[o.op](o); } catch (e) { out[o.id] = { ok: false, why: short(e) }; }
    out[o.id].ms = Date.now() - t;
    // (as it goes, where the fence lets it write: what was tried is known even if a later attempt hangs)
    if (cfg.out) { try { fs.writeFileSync(cfg.out, JSON.stringify(out)); } catch { /* not writable */ } }
  }
  // (and out at once: a lookup still waiting for an answer that won't come would keep this process going)
  process.stdout.write(`\nFENCE-PROBE ${JSON.stringify(out)}\n`, () => process.exit(0));
})();

'use strict';
// CI only (whole-box.yml): what TRIF's pinned Claude Code prints for `claude setup-token`, so claudetoken.js
// parses the real output, not a guess. Round 2 found it prints nothing useful without a terminal; this
// round it runs under the pseudo-terminal logins.js now uses (claudetoken.ptyCommand), with two TERMs, raw
// (ANSI codes kept, as JSON), then through logins.js itself. No account: nobody opens the sign-in URL; a
// stand-in code ("not a code") is typed to see how a wrong code is answered. The URL's query string (OAuth
// state, PKCE) and anything sk-ant-... are redacted from what's printed.
// node tests/whole-box/setup-token-probe.js <pin home: claudepin's, holding runtime/claude-code-*/>
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ct = require('../../helper/lib/claudetoken');
const cp = require('../../helper/lib/claudepin');
const { Logins } = require('../../helper/lib/logins');

const pinHome = process.argv[2];
const pin = cp.installedPinned(pinHome);
if (!pin) { console.log(`no pinned Claude Code under ${pinHome}`); process.exit(1); }
const clean = (s) => ct.redactTokens(String(s)).replace(/(https?:\/\/[^\s?#\x1b\x07]+)[?#][^\s\x1b\x07]*/g, '$1?…');
const STAND_IN_CODE = 'not-a-code#probe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let found = false;

function raw(term) {
  return new Promise((resolve) => {
    const config = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-config-'));
    const env = { PATH: '/usr/bin:/bin', HOME: os.homedir(), TERM: term, NO_COLOR: '1', BROWSER: '/usr/bin/true', CLAUDE_CONFIG_DIR: config, DISABLE_AUTOUPDATER: '1' };
    const p = ct.ptyCommand(pin.bin, ['setup-token']);
    const child = spawn(p.file, p.args, { env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    let out = '';
    let typedAt = -1;
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += `[stderr]${d}`; });
    child.stdin.on('error', () => {});
    const kill = (sig) => { try { process.kill(-child.pid, sig); } catch { /* gone */ } };
    const t1 = setTimeout(() => { typedAt = out.length; child.stdin.write(`${STAND_IN_CODE}\r`); }, 12000);
    const t2 = setTimeout(() => kill('SIGTERM'), 25000);
    const t3 = setTimeout(() => kill('SIGKILL'), 29000);
    child.on('exit', (code, signal) => {
      for (const t of [t1, t2, t3]) clearTimeout(t);
      const before = typedAt < 0 ? out : out.slice(0, typedAt);
      const after = typedAt < 0 ? '' : out.slice(typedAt);
      console.log(`=== raw, TERM=${term}: exit ${code} ${signal || ''}`);
      console.log(`--- before the stand-in code (${before.length} chars)\n${JSON.stringify(clean(before)).slice(0, 6000)}`);
      console.log(`--- after it (${after.length} chars)\n${JSON.stringify(clean(after)).slice(0, 6000)}`);
      const lines = out.split(/\r?\n|\r/).map((l) => l.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').trim()).filter(Boolean);
      const parsed = lines.map((l) => ct.parseSetupTokenLine(l)).filter(Boolean).map((e) => ({ kind: e.kind, ...(e.url ? { url: clean(e.url) } : {}), ...(e.text ? { text: clean(e.text) } : {}) }));
      console.log(`--- parsed (claudetoken.parseSetupTokenLine), distinct\n${[...new Set(parsed.map((e) => JSON.stringify(e)))].slice(0, 40).join('\n')}`);
      if (parsed.some((e) => e.kind === 'login')) found = true;
      console.log(`--- config folder after: ${JSON.stringify(fs.readdirSync(config))}`);
      fs.rmSync(config, { recursive: true, force: true });
      resolve();
    });
  });
}

async function viaLogins() {
  console.log('=== through logins.js (mode "token")');
  const events = [];
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-ws-'));
  // (TRIF's copy where installedPinned looks: the pin's folder, linked into this stand-in workspace)
  fs.mkdirSync(path.join(home, 'runtime'));
  fs.symlinkSync(pin.dir, path.join(home, 'runtime', path.basename(pin.dir)));
  const logins = new Logins({ getWorkspace: () => ({ home, bin: path.join(home, 'bin'), config: {} }), logger: { info: (m) => console.log(`[log] ${clean(m)}`), warn: (m) => console.log(`[warn] ${clean(m)}`), error: (m) => console.log(`[error] ${clean(m)}`), debug() {} },
    onEvent: (id, ev) => events.push(ev) });
  let started;
  try { started = logins.start({ agent: 'claude', mode: 'token' }); } catch (e) { console.log(`start refused: ${e.message}`); return; }
  for (let i = 0; i < 40 && !events.some((e) => e.kind === 'login' || e.kind === 'done'); i++) await sleep(500);
  if (events.some((e) => e.kind === 'login')) {
    found = true;
    await sleep(2000);
    try { logins.code(started.loginId, STAND_IN_CODE); } catch (e) { console.log(`code refused: ${e.message}`); }
    for (let i = 0; i < 30 && !events.some((e) => e.kind === 'done'); i++) await sleep(500);
  }
  if (!events.some((e) => e.kind === 'done')) await logins.stopAll();
  for (const e of events) console.log(JSON.stringify({ ...e, ...(e.url ? { url: clean(e.url) } : {}), ...(e.text ? { text: clean(e.text) } : {}), ...(e.message ? { message: clean(e.message) } : {}) }));
  fs.rmSync(home, { recursive: true, force: true });
}

(async () => {
  setTimeout(() => { console.log('--- probe gave up'); process.exit(1); }, 170000).unref();
  await raw('xterm-256color');
  await raw('dumb');
  await viaLogins();
  if (!found) { console.log('NO SIGN-IN URL FOUND'); process.exitCode = 1; }
})();

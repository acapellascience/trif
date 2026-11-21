'use strict';
// CI only (whole-box.yml): what TRIF's pinned Claude Code prints for `claude setup-token` without a terminal
// (stdin a pipe, as logins.js runs it), so claudetoken.js parses the real output, not a guess. No account:
// the sign-in is never completed (nobody opens the URL); stopped after a few seconds. The URL's query
// string (OAuth state, PKCE) and anything sk-ant-… are redacted from what's printed.
// node tests/whole-box/setup-token-probe.js <claude binary>
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const ct = require('../../helper/lib/claudetoken');

const bin = process.argv[2];
const config = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-config-'));
const env = { PATH: '/usr/bin:/bin', HOME: os.homedir(), TERM: 'dumb', BROWSER: '/usr/bin/true', CLAUDE_CONFIG_DIR: config, DISABLE_AUTOUPDATER: '1' };
const clean = (s) => ct.redactTokens(String(s)).replace(/(https?:\/\/[^\s?#]+)[?#]\S*/g, '$1?…');
const help = spawnSync(bin, ['setup-token', '--help'], { env, encoding: 'utf8', timeout: 30000 });
console.log(`--- setup-token --help (exit ${help.status})\n${clean(help.stdout)}${clean(help.stderr)}`);
const child = spawn(bin, ['setup-token'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
const out = { stdout: '', stderr: '' };
for (const k of ['stdout', 'stderr']) child[k].on('data', (d) => { out[k] += d; });
const parsed = [];
child.on('exit', (code, signal) => {
  for (const k of ['stdout', 'stderr']) {
    console.log(`--- ${k}\n${JSON.stringify(clean(out[k]))}`);
    for (const line of out[k].split(/\r?\n|\r/)) { const ev = ct.parseSetupTokenLine(line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim()); if (ev) parsed.push({ from: k, kind: ev.kind, ...(ev.url ? { url: clean(ev.url) } : {}), ...(ev.text ? { text: clean(ev.text) } : {}) }); }
  }
  console.log(`--- exit ${code} ${signal || ''}\n--- parsed\n${JSON.stringify(parsed, null, 1)}`);
  console.log(`--- config folder after: ${JSON.stringify(fs.readdirSync(config))}`);
  fs.rmSync(config, { recursive: true, force: true });
  if (!parsed.some((e) => e.kind === 'login')) { console.log('NO SIGN-IN URL FOUND'); process.exitCode = 1; }
});
setTimeout(() => child.kill('SIGTERM'), 15000);

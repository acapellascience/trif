#!/usr/bin/env node
'use strict';
// Whole box step 9b(5) on windows-latest: does TRIF read an organization's Claude Code policy where Claude
// Code reads it on Windows (code.claude.com/docs/en/managed-settings: C:\Program Files\ClaudeCode\, the
// `Settings` value under HKLM\SOFTWARE\Policies\ClaudeCode, and under HKCU\… when there's no admin source)?
// Each source in turn names a stand-in API in its `env` ANTHROPIC_BASE_URL (managed `env` wins over the
// process's: round 8); TRIF's pinned claude.exe (not boxed: this is about where the policy lives) shows
// which one it used, and claude-managed.check() must list that source. The runner's own machine only
// (GitHub Actions; never anyone's computer); everything it writes is taken out at the end.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { startFakeAnthropic } = require('../fake-anthropic-server');
const managed = require('../../helper/lib/agents/claude-managed');

if (process.platform !== 'win32') { console.error('win-managed-probe: Windows only'); process.exit(2); }
if (process.env.GITHUB_ACTIONS !== 'true') { console.error('win-managed-probe: GitHub Actions only (it writes HKLM and C:\\Program Files)'); process.exit(2); }
const bin = process.env.WBX_CLAUDE_BIN;
if (!bin) { console.error('WBX_CLAUDE_BIN: TRIF\'s pinned claude.exe'); process.exit(2); }

const reg = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
const KEY = 'SOFTWARE\\Policies\\ClaudeCode';
const dir = managed.systemDir('win32');
const file = path.join(dir, 'managed-settings.json');
const verdict = {};
const learned = {};

const setReg = (hive, json) => spawnSync(reg, ['add', `${hive}\\${KEY}`, '/v', 'Settings', '/t', 'REG_SZ', '/d', json, '/f'], { encoding: 'utf8' });
const delReg = (hive) => spawnSync(reg, ['delete', `${hive}\\${KEY}`, '/f'], { encoding: 'utf8' });
const policy = (api) => JSON.stringify({ env: { ANTHROPIC_BASE_URL: api.url, CLAUDE_CODE_MAX_RETRIES: '0' } });

function runClaude(own) {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'wbm-cfg-'));
  return new Promise((resolve) => {
    const env = { ...process.env, ANTHROPIC_BASE_URL: own.url, ANTHROPIC_API_KEY: 'trif-stand-in-key', CLAUDE_CONFIG_DIR: cfg, DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
    const c = spawn(bin, ['-p', '--output-format', 'json', '--model', 'claude-haiku-stand-in'], { env, cwd: cfg, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => c.kill(), 90000);
    c.on('close', (code) => { clearTimeout(t); resolve({ code, out: out.slice(-800) }); });
    c.stdin.end('Say hi.');
  });
}

(async () => {
  const apis = {};
  for (const k of ['own', 'file', 'hklm', 'hkcu']) apis[k] = await startFakeAnthropic({ script: [{ say: `hi from ${k}` }] });
  const which = () => Object.entries(apis).filter(([, a]) => a.requests.length).map(([k]) => k);
  const reset = () => { for (const a of Object.values(apis)) a.requests.length = 0; };
  const cases = [
    { name: 'the file only', set() { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, policy(apis.file)); }, want: 'file', source: file },
    { name: 'the file and HKLM', set() { setReg('HKLM', policy(apis.hklm)); }, want: 'hklm', source: `HKLM\\${KEY}` },
    { name: 'HKCU only (the file and HKLM taken out)', set() { fs.rmSync(file, { force: true }); delReg('HKLM'); setReg('HKCU', policy(apis.hkcu)); }, want: 'hkcu', source: `HKCU\\${KEY}` },
  ];
  try {
    for (const c of cases) {
      c.set();
      reset();
      const r = await runClaude(apis.own);
      const used = which();
      const trif = managed.check({ platform: 'win32', dir: null });
      console.log(`\n>>> ${c.name}: claude.exe exit ${r.code}; the stand-ins asked: ${used.join(', ') || '(none)'}\n  ${r.out.replace(/\s+/g, ' ').slice(0, 300)}`);
      console.log(`  TRIF's check: sources ${JSON.stringify(trif.sources)}; errors ${JSON.stringify(trif.errors)}; ports ${JSON.stringify(trif.network.ports)}; relay ${JSON.stringify(trif.network.relay)}`);
      learned[`${c.name}: Claude Code used`] = used.join(', ') || '(none)';
      verdict[`${c.name}: TRIF lists ${c.source}`] = trif.sources.some((s) => s.toLowerCase().includes(c.source.toLowerCase()));
      verdict[`${c.name}: Claude Code used a managed source, not the run's own`] = used.length > 0 && !used.includes('own');
      verdict[`${c.name}: the source Claude Code used is one TRIF read`] = used.every((u) => u === 'own' || cases.find((x) => x.want === u && trif.sources.some((s) => s.toLowerCase().includes(x.source.toLowerCase()))));
    }
  } finally {
    fs.rmSync(file, { force: true });
    delReg('HKLM');
    delReg('HKCU');
    for (const a of Object.values(apis)) await a.close();
  }
  console.log(`\n--- LEARNED (not checked)\n${Object.entries(learned).map(([k, x]) => `${String(x).padEnd(10)} ${k}`).join('\n')}`);
  console.log(`\n--- VERDICT\n${Object.entries(verdict).map(([k, x]) => `${String(!!x).padEnd(6)} ${k}`).join('\n')}`);
  const short = Object.entries(verdict).filter(([, x]) => !x).map(([k]) => k);
  if (short.length) console.log(`\nNOT SHOWN: ${short.join('; ')}`);
  process.exit(short.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

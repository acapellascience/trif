#!/usr/bin/env node
'use strict';
// Red-team: TRIF's per-run MAILBOX, attacked as a malicious fenced run would -- by writing forged request
// files straight into the run's box folder, WITHOUT the `trif` command.
//
// On Windows a side-panel run talks to the helper only through its box (TRIF_RUN_BOX): it writes `<id>.req`
// and the helper answers `<id>.res` (client.js boxRequest; helper serves it in runs.js _serveBox ->
// host.js onRunRequest -> onClientLine). The helper forces the run's own token onto whatever it finds
// there, so a run can't forge another run's token -- but it CAN put any {cmd, args} it likes in the box.
// This boots the REAL helper (helper/host.js) against a workspace holding two sites' mods, starts a run
// scoped to ONE site, and then -- as the run -- drops forged request files into that run's live box:
//   - commands the `trif` CLI never sends (mod.code, mod.diff): the side panel's code-viewer commands;
//   - another site's mod id, to read or delete across the scope the run is confined to;
//   - panel-only and agent-only commands (agent.logout, agent.start);
//   - malformed, oversized and link-planted request files (the box plumbing itself).
// It asks, for each: what does the helper act on, and can the run reach another site?
//
// PASS = the helper refused or confined it. BREAK = it crossed the run's scope (read/wrote/reached another
// site, ran a privileged command). INFO = neither, worth noting. Exits 1 on any BREAK.
//
// Runs on any OS (the stand-in fence, tests/fake-fence.js, and a stand-in agent that just stays alive): the
// helper's command gating and box handling are the same code on every platform. On windows-latest it also
// exercises the real NTFS box folder.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { FakeExtension, tempDir, privDir, waitFor, windowsShims } = require('../fake-extension');

const FAKE_FENCE = path.join(__dirname, '..', 'fake-fence.js');
const rows = [];
let broke = 0;
function record(verdict, id, detail) {
  if (verdict === 'BREAK') broke++;
  rows.push(`  ${verdict.padEnd(5)} ${id}${detail ? `  -- ${detail}` : ''}`);
}

const SECRET = `VICTIM-SECRET-${crypto.randomBytes(6).toString('hex')}`;

// A valid WebMod file, so the helper's scanMods picks it up into its mod list (state.mods).
function modFile(site, name, body) {
  return `// ==WebMod==\n// @name ${name}\n// @match https://${site}/*\n// ==/WebMod==\n${body}\n`;
}

// Forge a request straight into the box, the way client.js does (whole file, then rename into place), and
// wait for the helper's answer. No `trif`, no token of our own: the helper supplies the run's token.
function boxRequest(box, cmd, args = {}, { raw = null, timeoutMs = 8000 } = {}) {
  const id = `atk-${crypto.randomBytes(5).toString('hex')}`;
  const reqFile = path.join(box, `${id}.req`);
  const resFile = path.join(box, `${id}.res`);
  const tmp = path.join(box, `${id}.tmp`);
  const body = raw !== null ? raw : JSON.stringify({ id, cmd, args });
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, reqFile);
  const end = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const poll = setInterval(() => {
      let text;
      try { text = fs.readFileSync(resFile, 'utf8'); } catch {
        if (Date.now() > end) { clearInterval(poll); try { fs.unlinkSync(reqFile); } catch { /* taken */ } resolve({ timedOut: true }); }
        return;
      }
      clearInterval(poll);
      try { fs.unlinkSync(resFile); } catch { /* ignore */ }
      let msg = null; try { msg = JSON.parse(text); } catch { /* keep raw */ }
      resolve({ msg, text });
    }, 25);
  });
}

async function main() {
  const home = tempDir('mbx-');
  const priv = privDir(home);
  const bin = path.join(home, 'fakebin');
  fs.mkdirSync(bin, { recursive: true });

  // A stand-in agent named `claude`: it just stays alive (drains stdin, sleeps), so the run stays unfinished
  // and its box keeps being served while we drop forged requests in. It never speaks to the helper.
  const standinJs = path.join(bin, 'standin.js');
  fs.writeFileSync(standinJs, 'process.stdin.resume();process.stdin.on("data",()=>{});process.on("SIGTERM",()=>process.exit(0));setTimeout(()=>{},120000);\n');
  const standin = path.join(bin, 'claude');
  if (process.platform === 'win32') {
    // A node script; windowsShims() writes a claude.cmd beside it that runs it with this Node.
    fs.writeFileSync(standin, `#!/usr/bin/env node\nrequire(${JSON.stringify(standinJs)});\n`, { mode: 0o755 });
  } else {
    // A POSIX wrapper with an absolute node path, so it doesn't need node on the run's PATH.
    fs.writeFileSync(standin, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(standinJs)} "$@"\n`, { mode: 0o755 });
  }

  // The workspace: two sites' mods. The run will be scoped to attacker.com; victim.com is another site.
  fs.mkdirSync(path.join(home, 'sites', 'attacker.com'), { recursive: true });
  fs.mkdirSync(path.join(home, 'sites', 'victim.com'), { recursive: true });
  fs.writeFileSync(path.join(home, 'sites', 'attacker.com', 'mine.js'), modFile('attacker.com', 'Mine', '// the run\'s own site'));
  fs.writeFileSync(path.join(home, 'sites', 'victim.com', 'secret.js'), modFile('victim.com', 'Secret', `const KEY = "${SECRET}"; // another site's mod source`));
  fs.writeFileSync(path.join(home, 'AGENTS.md'), '# guide\n');
  fs.writeFileSync(path.join(priv, 'config.json'), JSON.stringify({ env: { PATH: bin } }));
  windowsShims(home);

  const ext = new FakeExtension({ home, env: { TRIF_FENCE_BIN: FAKE_FENCE, TRIF_AGENT_TIMEOUT_MS: '100000', TRIF_AGENT_KILL_GRACE_MS: '400' } });
  ext.handlers = {
    tabs: () => [{ id: 7, windowId: 1, active: true, url: 'https://attacker.com/page', title: 'A' }],
    status: () => ({ userScripts: true, chrome: '140.0.0.0', version: '0.0.0', mods: (ext.lastMods() || []).map((m) => ({ id: m.id, registered: true, enabled: true })), recording: [] }),
    reload: () => ({ url: 'https://attacker.com/page' }),
    errors: () => [], logs: () => [],
  };
  ext.hello();
  await ext.waitForSocket(15000);

  // Start a real run, scoped to attacker.com, over the helper's socket (as the side panel would).
  const net = require('net');
  const sock = net.connect(ext.ownSock);
  await new Promise((r, j) => { sock.on('connect', r); sock.on('error', j); });
  const started = new Promise((resolve) => {
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('data', (d) => { buf += d; let nl; while ((nl = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); if (!line.trim()) continue; let m; try { m = JSON.parse(line); } catch { continue; } if (m.id === 'start') resolve(m); } });
  });
  sock.write(JSON.stringify({ id: 'start', cmd: 'agent.start', args: { agent: 'claude', site: 'attacker.com', url: 'https://attacker.com/page', tabId: 7, prompt: 'probe' } }) + '\n');
  const startMsg = await started;
  if (!startMsg.ok) { record('INFO', 'could not start a run (harness)', String(startMsg.error)); throw new Error(`agent.start failed: ${startMsg.error}`); }
  const runId = startMsg.result.runId;
  const box = path.join(home, 'boxes', runId);
  await waitFor(() => fs.existsSync(box), { timeout: 15000, message: 'the run\'s box folder' });
  record('INFO', 'run started, box served', `runId ${runId}`);
  if (process.env.MBX_DEBUG) {
    for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 400)); console.error(`[dbg] t=${i * 400}ms box exists: ${fs.existsSync(box)}`); }
    try { console.error('[dbg] helper.log:\n' + fs.readFileSync(path.join(priv, 'helper.log'), 'utf8').split('\n').slice(-25).join('\n')); } catch (e) { console.error('[dbg] no helper.log: ' + e.message); }
  }

  const VICTIM = 'victim.com/secret';
  const got = (r) => (r.timedOut ? '(timed out)' : r.msg ? (r.msg.ok ? `ok: ${JSON.stringify(r.msg.result).slice(0, 80)}` : `refused: ${String(r.msg.error).slice(0, 80)}`) : `raw: ${String(r.text).slice(0, 80)}`);
  const leaked = (r) => !r.timedOut && r.msg && r.msg.ok && JSON.stringify(r.msg.result).includes(SECRET);
  // The box watcher can be a beat behind the first drop (fs.watch setup); warm it up and retry a timeout once.
  const forge = async (cmd, args, opts) => { let r = await boxRequest(box, cmd, args, opts); if (r.timedOut) r = await boxRequest(box, cmd, args, opts); return r; };
  await boxRequest(box, 'ping', {}).catch(() => {});

  // 1) mod.code for another site's mod: the code-viewer command, which `trif` never sends. No scope check?
  {
    const r = await forge('mod.code', { id: VICTIM });
    record(leaked(r) ? 'BREAK' : 'PASS', 'mod.code for another site\'s mod', leaked(r) ? `read victim.com's mod source across scope -- ${got(r)}` : got(r));
  }
  // 2) mod.diff for another site's mod: it answers for another site's mod id at all (its hash and, when a
  //    change is pending, its text) -- crossing the run's scope.
  {
    const r = await forge('mod.diff', { id: VICTIM });
    const crossed = !r.timedOut && r.msg && r.msg.ok && r.msg.result && r.msg.result.id === VICTIM;
    const body = crossed && JSON.stringify(r.msg.result.lines || '').includes(SECRET);
    record(crossed ? 'BREAK' : 'PASS', 'mod.diff for another site\'s mod', crossed ? `answered for victim.com's mod across scope${body ? ' (leaked its text)' : ' (leaked its hash/diff)'} -- ${got(r)}` : got(r));
  }
  // 3) mods: the whole mod list (every site), reachable with or without a token.
  {
    const r = await forge('mods', {});
    const sees = !r.timedOut && r.msg && r.msg.ok && Array.isArray(r.msg.result.mods) && r.msg.result.mods.some((m) => m.id === VICTIM);
    record(sees ? 'BREAK' : 'PASS', 'mods: enumerate every site\'s mods', sees ? 'the run saw victim.com/secret in the full mod list' : got(r));
  }
  // 4) mod.delete another site's mod: trash.js checkScope should refuse.
  {
    const r = await boxRequest(box, 'mod.delete', { id: VICTIM });
    const deleted = !r.timedOut && r.msg && r.msg.ok;
    const gone = !fs.existsSync(path.join(home, 'sites', 'victim.com', 'secret.js'));
    record(deleted || gone ? 'BREAK' : 'PASS', 'mod.delete another site\'s mod', deleted || gone ? 'deleted across scope' : got(r));
  }
  // 5) agent.logout: a PANEL-only command (never from a run or the socket).
  {
    const r = await boxRequest(box, 'agent.logout', { agent: 'claude' });
    const ran = !r.timedOut && r.msg && r.msg.ok;
    record(ran ? 'BREAK' : 'PASS', 'agent.logout (panel-only)', got(r));
  }
  // 6) agent.start: an AGENT command -- a run starting another run.
  {
    const r = await boxRequest(box, 'agent.start', { agent: 'claude', site: 'victim.com', url: 'https://victim.com/', prompt: 'x' });
    const ran = !r.timedOut && r.msg && r.msg.ok && r.msg.result && r.msg.result.runId;
    record(ran ? 'BREAK' : 'PASS', 'agent.start from a run (start another run)', got(r));
  }
  // 7) unknown command.
  {
    const r = await forge('totally.made.up', { x: 1 });
    const ran = !r.timedOut && r.msg && r.msg.ok;
    record(ran ? 'BREAK' : 'PASS', 'unknown command', got(r));
  }
  // 8) A page command with a forged wider scope in args: the helper must force the run's own scope.
  {
    const r = await boxRequest(box, 'tabs', { scope: 'victim.com', agentRun: 'someone-else' });
    // `tabs` goes to our fake extension; the point is the helper overwrote args.scope. We can't see the
    // extension's args here, but a non-error means it was accepted as the run's (scope forced). INFO.
    record('INFO', 'page command with forged args.scope', got(r));
  }
  // --- box plumbing: malformed / oversized / link-planted request files ---
  // 9) oversized request (> MAX_BOX_REQUEST = 8 MiB): must be treated as unreadable, not parsed.
  {
    const big = 'x'.repeat(9 * 1024 * 1024);
    const r = await boxRequest(box, 'ping', {}, { raw: JSON.stringify({ id: 'big', cmd: 'ping', pad: big }) });
    const unreadable = !r.timedOut && r.msg && r.msg.ok === false && /unreadable|bad request/i.test(String(r.msg.error));
    record(!r.timedOut && r.msg && r.msg.ok ? 'BREAK' : 'PASS', 'oversized request (>8 MiB)', unreadable ? 'rejected as unreadable' : got(r));
  }
  // 10) deeply nested JSON: the helper must not crash (stack overflow) handling it.
  {
    const deep = '['.repeat(60000) + ']'.repeat(60000);
    const r = await boxRequest(box, 'ping', {}, { raw: deep, timeoutMs: 6000 });
    // Any answer (even an error) means the helper survived; a timeout here (with the helper still answering
    // others below) would hint at a crash. Treat a crash of the whole helper as the real risk.
    record('INFO', 'deeply nested JSON request', got(r));
  }
  // 11) the request file planted as a symlink to a file outside the box (the helper reads it with a
  //     no-follow open + ino/dev recheck): it must not read through the link.
  {
    const outside = path.join(home, 'boxes', 'OUTSIDE-secret.txt');
    fs.writeFileSync(outside, `${SECRET}-via-link\n`);
    const id = `lnk-${crypto.randomBytes(4).toString('hex')}`;
    let planted = true;
    try { fs.symlinkSync(outside, path.join(box, `${id}.req`), 'file'); } catch { planted = false; }
    if (planted) {
      const resFile = path.join(box, `${id}.res`);
      const r = await new Promise((resolve) => { const end = Date.now() + 5000; const p = setInterval(() => { let t; try { t = fs.readFileSync(resFile, 'utf8'); } catch { if (Date.now() > end) { clearInterval(p); resolve({ timedOut: true }); } return; } clearInterval(p); try { fs.unlinkSync(resFile); } catch { /* ignore */ } let m = null; try { m = JSON.parse(t); } catch { /* raw */ } resolve({ msg: m, text: t }); }, 25); });
      const read = !r.timedOut && r.text && r.text.includes(`${SECRET}-via-link`);
      record(read ? 'BREAK' : 'PASS', 'request file is a symlink to an outside file', read ? 'the helper read through the link' : (r.timedOut ? 'ignored (not acted on)' : got(r)));
      try { fs.unlinkSync(path.join(box, `${id}.req`)); } catch { /* taken */ }
    } else record('INFO', 'request file is a symlink to an outside file', 'symlinks not creatable here');
  }
  // 12) a pre-planted `.res` (replay): the helper answers by renaming a fresh file over it -- the plant
  //     must not survive to fool the run. We prove the helper overwrites our plant with its real answer.
  {
    const id = `rpl-${crypto.randomBytes(4).toString('hex')}`;
    fs.writeFileSync(path.join(box, `${id}.res`), JSON.stringify({ id, ok: true, result: { forged: SECRET } }));
    fs.writeFileSync(path.join(box, `${id}.tmp`), JSON.stringify({ id, cmd: 'ping', args: {} }));
    fs.renameSync(path.join(box, `${id}.tmp`), path.join(box, `${id}.req`));
    const resFile = path.join(box, `${id}.res`);
    const r = await waitFor(() => { try { const t = fs.readFileSync(resFile, 'utf8'); if (!t.includes('"forged"')) return t; } catch { /* not yet */ } return null; }, { timeout: 5000, message: 'the helper\'s real answer over the plant' }).catch(() => null);
    record(r ? 'PASS' : 'BREAK', 'pre-planted .res (replay)', r ? 'the helper overwrote the plant with its own answer' : 'the forged .res survived (a run could fake its own answer)');
    try { fs.unlinkSync(resFile); } catch { /* ignore */ }
  }

  // Tidy up: stop the run and shut the helper down.
  try { sock.write(JSON.stringify({ id: 'stop', cmd: 'agent.stop', args: { runId } }) + '\n'); } catch { /* ignore */ }
  await new Promise((r) => setTimeout(r, 300));
  try { sock.destroy(); } catch { /* ignore */ }
  await ext.close(8000).catch(() => {});
  try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ }

  console.log('TRIF per-run mailbox, attacked with forged request files:');
  for (const r of rows) console.log(r);
  console.log(`\n${broke ? `FAIL: ${broke} break(s) -- a run crossed its scope` : 'all held: no forged request crossed the run\'s scope'}`);
  process.exit(broke ? 1 : 0);
}

main().catch((e) => { console.error(`mailbox-attacks: harness error: ${e && e.stack || e}`); process.exit(2); });

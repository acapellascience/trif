'use strict';
// The folders an agent run may write (its screenshots folder, the mods folder, its mailbox) can be replaced
// by that run with a link; the next run's limits must not follow it (runs.js screenshotsFolder,
// checkModsFolder, workspaceLinks). Links a run leaves in the mods folder mustn't widen the next run's
// limits either.

const test = require('./posix-only')('side-panel runs (not on Windows yet), symlinks');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { FakeExtension, tempDir, privDir } = require('./fake-extension');
const claude = require('../helper/lib/agents/claude');
const codex = require('../helper/lib/agents/codex');
const { runLimits } = require('../helper/lib/runs');
const P = require('../helper/lib/paths');

const cleanups = [];
test.after(async () => { for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* ignore */ } } });

function withHome(h, fn) {
  const old = process.env.HOME;
  process.env.HOME = h;
  try { return fn(); } finally { process.env.HOME = old; }
}

// A home folder with a workspace (~/.trif), its private folder, and what a planted link points at:
// ~/.trif/bin, which holds trif-host (what the browser starts, outside any sandbox).
function linkHome() {
  const h = fs.realpathSync(tempDir());
  const trif = path.join(h, '.trif');
  const box = path.join(h, 'Library', 'Caches', 'TRIF', 'boxes', 'r1');
  for (const d of [path.join(trif, 'sites'), path.join(trif, 'bin'), box, path.join(h, '.ssh')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(trif, 'bin', 'trif-host'), '#!/bin/sh\n');
  fs.writeFileSync(path.join(h, '.ssh', 'id_rsa'), 'PRIVATE');
  const ws = withHome(h, () => P.workspace(trif));
  const shots = path.join(ws.private, 'screenshots', 'x.com');
  return { h, trif, ws, box, bin: path.join(trif, 'bin'), shots, limits: (w = ws) => withHome(h, () => runLimits(w, { scope: 'x.com', box, screenshots: shots })) };
}

const under = (p, dir) => p === dir || p.startsWith(dir + path.sep);

test('a screenshots folder a run replaced with a link is made again, never followed', () => {
  const { h, ws, bin, shots, limits } = linkHome();
  // What a prompt-injected run can do: rm -rf "$TRIF_RUN_SCREENSHOTS"; ln -s ~/.trif/bin "$TRIF_RUN_SCREENSHOTS"
  fs.mkdirSync(path.dirname(shots), { recursive: true });
  fs.symlinkSync(bin, shots);
  const lim = limits();
  assert.ok(!lim.writable.some((p) => under(p, bin)), `writable: ${lim.writable.join(', ')}`);
  assert.equal(lim.screenshots, path.join(fs.realpathSync(ws.private), 'screenshots', 'x.com'));
  assert.ok(fs.lstatSync(shots).isDirectory(), 'a folder again');
  assert.ok(fs.existsSync(path.join(bin, 'trif-host')), 'the link was removed, not followed');
  const sb = JSON.parse(claude.command({ bin: '/x/claude', prompt: 'P', ...lim }).files[0].content).sandbox.filesystem;
  assert.ok(!sb.allowWrite.some((p) => under(p, bin)));
  const perm = codex.command({ bin: '/x/codex', prompt: 'P', ...lim }).args.find((a) => a.startsWith('permissions='));
  assert.ok(!perm.includes(`${JSON.stringify(bin)} = "write"`));

  // The same for the screenshots folder above it.
  fs.rmSync(path.join(ws.private, 'screenshots'), { recursive: true });
  fs.symlinkSync(bin, path.join(ws.private, 'screenshots'));
  const lim2 = limits();
  assert.ok(fs.lstatSync(path.join(ws.private, 'screenshots')).isDirectory());
  assert.ok(!lim2.writable.some((p) => under(p, bin)) && fs.existsSync(path.join(bin, 'trif-host')));

  // Links left inside the run's folder are removed (Claude Code's Read tool may read that folder).
  fs.symlinkSync(path.join(h, '.ssh'), path.join(shots, 'keys'));
  fs.mkdirSync(path.join(shots, 'sub'));
  fs.symlinkSync(path.join(h, '.ssh', 'id_rsa'), path.join(shots, 'sub', 'k.png'));
  fs.writeFileSync(path.join(shots, 'shot.png'), 'png');
  limits();
  assert.equal(fs.existsSync(path.join(shots, 'keys')), false, 'link inside removed');
  assert.equal(fs.existsSync(path.join(shots, 'sub', 'k.png')), false, 'link further down removed');
  assert.ok(fs.existsSync(path.join(shots, 'shot.png')), 'screenshots kept');
  assert.ok(fs.existsSync(path.join(h, '.ssh', 'id_rsa')));
});

test('a mods folder that is a link, or leads elsewhere than when TRIF was set up, refuses the run', () => {
  const { trif, ws, bin, limits } = linkHome();
  fs.rmSync(path.join(trif, 'sites'), { recursive: true });
  fs.symlinkSync(bin, path.join(trif, 'sites'));
  assert.throws(() => limits(), /mods folder .* is a link/);
  fs.unlinkSync(path.join(trif, 'sites'));
  fs.writeFileSync(path.join(trif, 'sites'), 'not a folder');
  assert.throws(() => limits(), /isn't a folder/);
  fs.unlinkSync(path.join(trif, 'sites'));
  fs.mkdirSync(path.join(trif, 'sites'));
  // Recorded at setup (config.json modsDirReal), and now leading somewhere else.
  const other = fs.realpathSync(tempDir());
  assert.throws(() => limits({ ...ws, config: { modsDirReal: { path: ws.modsDir, real: path.join(other, 'sites') } } }), /now leads to/);
  const lim = limits({ ...ws, config: { modsDirReal: { path: ws.modsDir, real: fs.realpathSync(ws.modsDir) } } });
  assert.ok(lim.writable.includes(fs.realpathSync(ws.modsDir)));
  // A record for another mods folder (config.json's modsDir changed since): not this one's business.
  assert.ok(limits({ ...ws, config: { modsDirReal: { path: '/somewhere/else', real: '/x' } } }));
});

test('setup records the mods folder\'s real path in config.json', () => {
  const { recordPath } = require('../helper/lib/setup');
  const home = tempDir();
  fs.mkdirSync(path.join(home, 'sites'));
  const r = recordPath(home, '/bin', path.join(home, 'sites'));
  assert.equal(r.error, null);
  const cfg = JSON.parse(fs.readFileSync(path.join(privDir(home), 'config.json'), 'utf8'));
  assert.deepEqual(cfg.modsDirReal, { path: path.join(home, 'sites'), real: fs.realpathSync(path.join(home, 'sites')) });
  fs.rmSync(path.join(home, 'sites'), { recursive: true });
  fs.symlinkSync(tempDir(), path.join(home, 'sites'));
  recordPath(home, '/bin', path.join(home, 'sites'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(privDir(home), 'config.json'), 'utf8')).modsDirReal, undefined, 'not for a link');
});

test('links in the mods folder (a site folder, in a site folder, in the trash) widen nothing', () => {
  const { h, trif, bin, limits } = linkHome();
  const la = path.join(h, 'Library', 'LaunchAgents');
  fs.mkdirSync(la, { recursive: true });
  const sites = path.join(trif, 'sites');
  // Left by an earlier Codex run: another site's folder leading out, and links in this site's folder.
  fs.symlinkSync(la, path.join(sites, 'y.com'));
  fs.mkdirSync(path.join(sites, 'x.com'));
  fs.symlinkSync(path.join(bin, 'trif-host'), path.join(sites, 'x.com', 'host.js'));
  fs.symlinkSync(path.join(h, '.ssh'), path.join(sites, 'x.com', 'keys'));
  fs.writeFileSync(path.join(sites, 'x.com', 'a.js'), '//');
  fs.symlinkSync(path.join(sites, 'x.com', 'a.js'), path.join(sites, 'x.com', 'b.js')); // within: fine
  fs.mkdirSync(path.join(trif, 'trash', 'x.com'), { recursive: true });
  fs.symlinkSync(path.join(h, '.ssh', 'id_rsa'), path.join(trif, 'trash', 'x.com', 'k.js'));
  const lim = limits();
  assert.ok(!lim.readOnly.includes(la), 'where a link out of the mods folder leads is never made readable');
  assert.ok(!lim.writable.some((p) => under(p, la) || under(p, bin)));
  const perm = codex.command({ bin: '/x/codex', prompt: 'P', ...lim }).args.find((a) => a.startsWith('permissions='));
  assert.ok(!perm.includes(JSON.stringify(la)));
  const deny = JSON.parse(claude.command({ bin: '/x/claude', prompt: 'P', ...lim }).files[0].content).permissions.deny;
  for (const r of [`Edit(/${sites}/y.com/**)`, `Edit(/${sites}/x.com/host.js)`, `Edit(/${sites}/x.com/keys/**)`, `Read(/${sites}/x.com/keys/**)`,
    `Read(/${sites}/x.com/keys)`, `Read(/${path.join(trif, 'trash', 'x.com', 'k.js')})`]) assert.ok(deny.includes(r), `${r} in ${deny.join(' ')}`);
  assert.ok(!deny.some((r) => r.includes('b.js') || r.includes('a.js')), 'links within the mods folder are fine');
  assert.ok(!deny.includes(`Read(/${sites}/x.com/host.js)`), 'the workspace is readable anyway: only not editable');
});

test('agent.start: a mods folder replaced with a link ends the run with an error before the agent starts', async () => {
  const home = tempDir();
  const target = path.join(home, 'elsewhere');
  fs.mkdirSync(target);
  fs.symlinkSync(target, path.join(home, 'sites'));
  fs.writeFileSync(path.join(privDir(home), 'config.json'), JSON.stringify({ env: { PATH: '/nonexistent' } }));
  const ext = new FakeExtension({ home });
  cleanups.push(() => ext.close());
  ext.send({ type: 'request', id: 'a1', cmd: 'agent.start', args: { site: 'example.com', url: 'https://example.com/', prompt: 'hi' } });
  const r = await ext.next((m) => m.type === 'response' && m.id === 'a1');
  const runId = r.result.runId;
  const done = await ext.next((m) => m.type === 'agentEvent' && m.runId === runId && m.event.kind === 'done');
  assert.equal(done.event.ok, false);
  const errors = ext.messages.filter((m) => m.type === 'agentEvent' && m.runId === runId && m.event.kind === 'error').map((m) => m.event.message);
  assert.ok(errors.some((e) => /is a link/.test(e)), errors.join('\n'));
  assert.ok(fs.readdirSync(target).length === 0, 'nothing written where the link leads');
});

test('screenshots older than 30 days are deleted (every site\'s folder), newer ones kept', () => {
  const { pruneScreenshots, SCREENSHOT_KEEP_MS } = require('../helper/lib/runs');
  const root = path.join(tempDir(), 'screenshots');
  fs.mkdirSync(path.join(root, 'x.com'), { recursive: true });
  const old = path.join(root, 'x.com', 'old.png');
  const fresh = path.join(root, 'x.com', 'new.png');
  const top = path.join(root, 'terminal.png');
  for (const f of [old, fresh, top]) fs.writeFileSync(f, 'png');
  const past = (Date.now() - SCREENSHOT_KEEP_MS - 60000) / 1000;
  fs.utimesSync(old, past, past);
  fs.utimesSync(top, past, past);
  pruneScreenshots(root);
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(top), false);
  assert.ok(fs.existsSync(fresh));
});

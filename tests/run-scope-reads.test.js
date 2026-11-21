'use strict';
// What a side-panel run may ask the helper, attacked as a run gone wrong would: with requests it writes
// straight into its own mailbox (no `trif`), and with its token on the socket. The real helper (helper/host.js)
// in a temp home, a stand-in agent that stays alive, runs each held to one site:
//   - `mods` lists the run's own site's mods alone, not every site's;
//   - `mod.code` and `mod.diff` answer only for the run's own site's mods (the rule its delete goes by,
//     trash.js siteInScope), a phone view's run for its phone twin's, a sensitive site of its own and its
//     parent each for their own;
//   - `ping` tells a run of its own mods and of itself, not of the other sites' or the other runs;
//   - a command a run has no business sending is refused by the helper, never sent on to the extension.
// The side panel and the user's terminal (no run) read every mod as before, and the run's own `trif` works.
// (First found by the Windows red-team, branch windows-redteam, tests/redteam/mailbox-attacks.js.)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { FakeExtension, tempDir, privDir, waitFor, runCli, writeMod } = require('./fake-extension');

const cleanups = [];
test.after(async () => {
  for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* ignore */ } }
});

const SECRET = `VICTIM-SECRET-${crypto.randomBytes(6).toString('hex')}`;
const head = (match, body = '', extra = '') => `// ==WebMod==\n// @match ${match}\n${extra}// ==/WebMod==\n${body}`;

// A stand-in Claude Code: it notes the run it was started for (its mailbox and token) and stays alive, so the
// run's mailbox keeps being served. It never speaks to the helper itself.
const FAKE = `#!${process.execPath}
'use strict';
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('9.9.9 (Claude Code)'); process.exit(0); }
if (argv[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
fs.readFileSync(0, 'utf8');
const dir = path.join(__dirname, 'calls');
fs.mkdirSync(dir, { recursive: true });
const env = {};
for (const k of Object.keys(process.env)) if (k.startsWith('TRIF_RUN_')) env[k] = process.env[k];
fs.writeFileSync(path.join(dir, path.basename(String(process.env.TRIF_RUN_BOX)) + '.json'), JSON.stringify({ cwd: process.cwd(), env }));
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }) + '\\n');
setInterval(() => {}, 1000);
`;

let n = 0;
async function ask(ext, cmd, args = {}) {
  const id = `q${++n}`;
  ext.send({ type: 'request', id, cmd, args });
  return ext.next((m) => m.type === 'response' && m.id === id, { timeout: 15000 });
}

function sockRequest(sock, msg, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const s = net.connect(sock);
    let buf = '';
    const t = setTimeout(() => { s.destroy(); reject(new Error(`no answer to ${msg.cmd} on the socket within ${timeout}ms`)); }, timeout);
    s.setEncoding('utf8');
    s.on('connect', () => s.write(JSON.stringify(msg) + '\n'));
    s.on('data', (d) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl !== -1) { clearTimeout(t); s.destroy(); resolve(JSON.parse(buf.slice(0, nl))); }
    });
    s.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

// A request written straight into a run's mailbox, as client.js boxRequest writes one (whole, then renamed
// into place), and the helper's answer. No token of its own: the helper takes it as the run's.
async function forge(box, cmd, args = {}, timeout = 8000) {
  const id = `atk-${crypto.randomBytes(5).toString('hex')}`;
  fs.writeFileSync(path.join(box, `${id}.tmp`), JSON.stringify({ id, cmd, args }) + '\n');
  fs.renameSync(path.join(box, `${id}.tmp`), path.join(box, `${id}.req`));
  const res = path.join(box, `${id}.res`);
  const text = await waitFor(() => { try { return fs.readFileSync(res, 'utf8'); } catch { return null; } }, { timeout, message: `the helper's answer to a forged ${cmd}` });
  try { fs.unlinkSync(res); } catch { /* ignore */ }
  return JSON.parse(text);
}

// One helper, a workspace with several sites' mods, and a run for each of the scopes below.
let shared = null;
async function world() {
  if (shared) return shared;
  const home = tempDir();
  const bin = path.join(home, 'fakebin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'claude'), FAKE);
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
  fs.writeFileSync(path.join(privDir(home), 'config.json'), JSON.stringify({ env: { PATH: bin } }));
  fs.writeFileSync(path.join(home, 'AGENTS.md'), '# guide\n');

  writeMod(home, 'attacker.com', 'mine.js', head('https://attacker.com/*', '// the run\'s own site\n'));
  writeMod(home, 'www.attacker.com', 'part.js', head('https://www.attacker.com/*', '// a part of its site\n'));
  writeMod(home, 'victim.com', 'secret.js', head('https://victim.com/*', `const KEY = "${SECRET}"; // another site's mod\n`));
  // (a style mod: its whole file rides in the mod as \`text\`; and a warning, which names its file)
  writeMod(home, 'victim.com', 'style.js', `// ==WebMod==\n// @match https://victim.com/*\n// @style\n// @run-at whenever\n// ==/WebMod==\n{"css": ".x-${SECRET} { color: red }"}\n`);
  writeMod(home, 'all-sites', 'dark.js', head('*://*/*', `// every site's: ${SECRET}\n`));
  writeMod(home, 'phone~attacker.com', 'bar.js', head('https://attacker.com/*', `// attacker.com's phone twin: ${SECRET}\n`));
  // a phone view's run: its twin, its site's desktop folder, another site's twin
  writeMod(home, 'phone~phonesite.org', 'bar.js', head('https://phonesite.org/*', '// the phone view\'s own\n'));
  writeMod(home, 'phonesite.org', 'desk.js', head('https://phonesite.org/*', `// its desktop mod: ${SECRET}\n`));
  writeMod(home, 'phone~victim.com', 'bar.js', head('https://victim.com/*', `// another site's twin: ${SECRET}\n`));
  // a sensitive site of its own under example.com, and its parent
  writeMod(home, 'example.com', 'plain.js', head('https://example.com/*', '// the parent\'s: PARENT-MARK\n'));
  writeMod(home, 'docs.example.com', 'docs.js', head('https://docs.example.com/*', '// a part of the parent\n'));
  writeMod(home, 'mail.example.com', 'inbox.js', head('https://mail.example.com/*', '// the sensitive site\'s: INBOX-MARK\n'));

  const ext = new FakeExtension({ home, env: { TRIF_AGENT_KILL_GRACE_MS: '400', TRIF_AGENT_TIMEOUT_MS: '170000' } });
  cleanups.push(() => ext.close());
  ext.handlers = {
    tabs: (args) => ({ scope: args.scope ?? null, agentRun: args.agentRun ?? null }),
    status: () => ({ userScripts: true, chrome: '140.0.0.0', version: '0.1.0', mods: (ext.lastMods() || []).map((m) => ({ id: m.id, registered: true, enabled: true })), recording: [], sitesOn: [] }),
  };
  ext.hello();
  await ext.waitForSocket();
  await ext.nextMods((ms) => ms.length >= 11, { timeout: 10000 });

  const SPLITS = ['mail.example.com'];
  const starts = {
    desktop: { site: 'attacker.com', url: 'https://attacker.com/page', tabId: 7 },
    phone: { site: 'phonesite.org', scope: 'phone~phonesite.org', url: 'https://phonesite.org/home', tabId: 8, phone: { device: 'iPhone', width: 390 } },
    parent: { site: 'example.com', splits: SPLITS, url: 'https://example.com/', tabId: 9 },
    sensitive: { site: 'mail.example.com', scope: 'mail.example.com', splits: SPLITS, url: 'https://mail.example.com/', tabId: 10 },
  };
  const runs = {};
  for (const [name, args] of Object.entries(starts)) {
    const r = await ask(ext, 'agent.start', { agent: 'claude', prompt: 'probe', ...args });
    assert.ok(r.ok, `agent.start (${name}): ${r.error}`);
    const runId = r.result.runId;
    const call = await waitFor(() => { try { return JSON.parse(fs.readFileSync(path.join(bin, 'calls', `${runId}.json`), 'utf8')); } catch { return null; } }, { timeout: 30000, message: `the stand-in agent of the ${name} run` });
    runs[name] = { runId, box: call.env.TRIF_RUN_BOX, token: call.env.TRIF_RUN_TOKEN, env: call.env };
    assert.equal(path.basename(runs[name].box), runId);
  }
  shared = { home, ext, runs };
  return shared;
}

const idsOf = (res) => res.result.mods.map((m) => m.id).sort();
const refusedAsAnothers = (res, what) => {
  assert.equal(res.ok, false, `${what}: answered ${JSON.stringify(res.result || null).slice(0, 200)}`);
  assert.match(res.error, /another site's/, what);
  assert.ok(!JSON.stringify(res).includes(SECRET), `${what}: the answer carries the other site's text`);
};

test('a run\'s forged mod.code and mod.diff: its own site\'s mods only, another site\'s refused (and no word on which there are)', { timeout: 120000 }, async () => {
  const { runs } = await world();
  const { box, token } = runs.desktop;
  for (const cmd of ['mod.code', 'mod.diff']) {
    refusedAsAnothers(await forge(box, cmd, { id: 'victim.com/secret' }), `${cmd} victim.com/secret`);
    refusedAsAnothers(await forge(box, cmd, { id: 'victim.com/style' }), `${cmd} victim.com/style`);
    // (a scope of its own choosing, or none: the run's anyway)
    refusedAsAnothers(await forge(box, cmd, { id: 'victim.com/secret', scope: 'victim.com', scopeSplits: [], agentRun: null }), `${cmd} with a forged scope`);
    // every-site mods and its site's phone twin aren't its delete's either (trash.js): not its reads through the helper
    refusedAsAnothers(await forge(box, cmd, { id: 'all-sites/dark' }), `${cmd} all-sites/dark`);
    refusedAsAnothers(await forge(box, cmd, { id: 'phone~attacker.com/bar' }), `${cmd} phone~attacker.com/bar`);
    // a mod that isn't there, another site's: the same refusal as one that is
    const there = await forge(box, cmd, { id: 'victim.com/secret' });
    const gone = await forge(box, cmd, { id: 'victim.com/no-such-mod' });
    assert.equal(gone.error.replace('no-such-mod', 'secret'), there.error);
    // ids that aren't ids
    for (const id of ['', 'victim.com', '../victim.com/secret', 'attacker.com/../victim.com/secret', undefined, 7, ['victim.com/secret']]) {
      const r = await forge(box, cmd, { id });
      assert.equal(r.ok, false, `${cmd} ${JSON.stringify(id)}`);
      assert.ok(!JSON.stringify(r).includes(SECRET));
    }
    // the same with its token on the socket (`trif` in a run that has one)
    refusedAsAnothers(await sockRequest((await world()).ext.sock, { id: 's', cmd, args: { id: 'victim.com/secret' }, token }), `${cmd} on the socket`);
  }
  // `version: 'ran'` (the version before a waiting change) is no way round
  refusedAsAnothers(await forge(box, 'mod.code', { id: 'victim.com/secret', version: 'ran' }), 'mod.code version ran');

  // delete and restore of another site's mod: refused before anything is looked up, too (trash.js checkSite)
  for (const [cmd, verb] of [['mod.delete', 'delete'], ['mod.restore', 'restore']]) {
    const there = await forge(box, cmd, { id: 'victim.com/secret' });
    const gone = await forge(box, cmd, { id: 'victim.com/no-such-mod' });
    assert.match(there.error, new RegExp(`can only ${verb} mods of attacker\\.com; victim\\.com/secret is another site's`));
    assert.equal(gone.error.replace('no-such-mod', 'secret'), there.error, `${cmd}: the same answer for a mod that isn't there`);
  }
  assert.ok(fs.existsSync(path.join((await world()).home, 'sites', 'victim.com', 'secret.js')));

  // its own site's: as before
  const own = await forge(box, 'mod.code', { id: 'attacker.com/mine' });
  assert.equal(own.ok, true, own.error);
  assert.match(own.result.code, /the run's own site/);
  assert.equal(own.result.file, 'mine.js');
  const part = await forge(box, 'mod.code', { id: 'www.attacker.com/part' });
  assert.equal(part.ok, true, part.error);
  const diff = await forge(box, 'mod.diff', { id: 'attacker.com/mine' });
  assert.equal(diff.ok, true, diff.error);
  assert.equal(diff.result.id, 'attacker.com/mine');
  const none = await forge(box, 'mod.code', { id: 'attacker.com/no-such-mod' });
  assert.match(none.error, /^no mod attacker\.com\/no-such-mod/);
});

test('a run\'s forged mods: its own site\'s mods alone, with nothing of another site\'s (ids, text, files, warnings)', { timeout: 120000 }, async () => {
  const { runs, ext } = await world();
  const res = await forge(runs.desktop.box, 'mods', {});
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(idsOf(res), ['attacker.com/mine', 'www.attacker.com/part']);
  const text = JSON.stringify(res);
  for (const leak of [SECRET, 'victim.com', 'phonesite.org', 'example.com', 'all-sites/dark']) assert.ok(!text.includes(leak), `the run's mods answer names ${leak}`);
  assert.ok(res.result.warnings.every((w) => w.id.startsWith('attacker.com/')), JSON.stringify(res.result.warnings));
  // the same with its token on the socket
  const viaSock = await sockRequest(ext.sock, { id: 'm', cmd: 'mods', args: {}, token: runs.desktop.token });
  assert.deepEqual(idsOf(viaSock), ['attacker.com/mine', 'www.attacker.com/part']);
  // (the user's terminal, no run: every mod, and the other site's warning, as before)
  const all = await sockRequest(ext.sock, { id: 'a', cmd: 'mods', args: {} });
  assert.ok(idsOf(all).includes('victim.com/secret') && idsOf(all).includes('all-sites/dark'), idsOf(all).join(' '));
  assert.ok(all.result.warnings.some((w) => w.id === 'victim.com/style'), 'the terminal sees the other site\'s warning');
  assert.ok(JSON.stringify(all).includes(SECRET), 'a style mod\'s text is in the full list (what the run no longer gets)');
});

test('a run\'s ping: its own mods and itself, not the other sites\' mods or the other runs', { timeout: 120000 }, async () => {
  const { runs, ext } = await world();
  const res = await forge(runs.desktop.box, 'ping', {});
  assert.equal(res.ok, true, res.error);
  // (all-sites/ is a folder a desktop run may change, so its mods' holds and errors are its to hear of)
  assert.deepEqual([...res.result.mods].sort(), ['all-sites/dark', 'attacker.com/mine', 'www.attacker.com/part']);
  assert.deepEqual(res.result.runs.map((r) => r.runId), [runs.desktop.runId]);
  assert.equal(res.result.login, null);
  const text = JSON.stringify(res);
  for (const leak of ['victim.com', 'phonesite.org', 'example.com', runs.phone.runId, runs.sensitive.runId]) assert.ok(!text.includes(leak), `the run's ping names ${leak}`);
  assert.ok(res.result.helper && res.result.pid && res.result.modsDir, 'what `trif status` reads of the helper is there');
  // a phone view's run: its twin's alone (all-sites/ isn't a folder it may change)
  const phone = await forge(runs.phone.box, 'ping', {});
  assert.deepEqual(phone.result.mods, ['phone~phonesite.org/bar']);
  assert.deepEqual(phone.result.runs.map((r) => r.runId), [runs.phone.runId]);
  // (the user's terminal: everything, as before)
  const all = await sockRequest(ext.sock, { id: 'p', cmd: 'ping', args: {} });
  assert.ok(all.result.mods.includes('victim.com/secret'));
  assert.equal(all.result.runs.length, 4);
});

test('a command a run may not send is refused by the helper, never sent on to the extension', { timeout: 120000 }, async () => {
  const { runs, ext } = await world();
  const { box, token } = runs.desktop;
  const since = ext.messages.length;
  for (const cmd of ['totally.made.up', 'mods.pause', 'site.set', 'phone.open', 'agentSite.set', 'constructor', '__proto__', 'x'.repeat(5000)]) {
    const r = await forge(box, cmd, { x: 1, site: 'victim.com', on: true });
    assert.equal(r.ok, false, cmd.slice(0, 40));
    assert.match(r.error, /isn't a command an agent run can send/, cmd.slice(0, 40));
    assert.ok(r.error.length < 300, 'the refusal doesn\'t echo a long command back');
  }
  const viaSock = await sockRequest(ext.sock, { id: 'u', cmd: 'totally.made.up', args: {}, token });
  assert.match(viaSock.error, /isn't a command an agent run can send/);
  // `trif phone page|try|screenshot` are a phone run's alone (phone-link-e2e.test.js has a phone run's side)
  for (const cmd of ['remote.page', 'remote.try', 'remote.screenshot']) {
    assert.match((await forge(box, cmd, { id: 'victim.com/secret' })).error, /in a run they started from the phone: this isn't one/, cmd);
  }
  // the commands that were the user's alone still say so
  assert.match((await forge(box, 'agent.start', { site: 'victim.com', url: 'https://victim.com/', prompt: 'x' })).error, /isn't available inside an agent run/);
  assert.match((await forge(box, 'mod.historyCode', { id: 'victim.com/secret', stamp: 'x' })).error, /isn't available inside an agent run/);
  assert.match((await forge(box, 'files.list', { site: 'victim.com' })).error, /isn't available inside an agent run/);
  assert.match((await forge(box, 'agent.logout', { agent: 'claude' })).error, /only a click in TRIF's side panel/);
  // a page command the run's `trif` sends goes on, held to the run's site
  const tabs = await forge(box, 'tabs', { scope: 'victim.com', agentRun: 'someone-else' });
  assert.deepEqual(tabs.result, { scope: 'attacker.com', agentRun: runs.desktop.runId });
  // (`trif not-broken` too: the extension holds it to the run's site's mods, background.js mod.notBroken)
  ext.handlers['mod.notBroken'] = (args) => ({ scope: args.scope ?? null, id: args.id });
  const nb = await forge(box, 'mod.notBroken', { id: 'victim.com/secret', scope: 'victim.com' });
  delete ext.handlers['mod.notBroken'];
  assert.deepEqual(nb.result, { scope: 'attacker.com', id: 'victim.com/secret' });
  const sent = ext.messages.slice(since).filter((m) => m.type === 'request').map((m) => m.cmd);
  assert.deepEqual(sent, ['tabs', 'mod.notBroken'], 'nothing but the page commands reached the extension');
  // (the user's terminal: an unknown command still goes to the extension, which says what it makes of it)
  ext.handlers['totally.made.up'] = () => ({ reached: 'the extension' });
  const term = await sockRequest(ext.sock, { id: 't', cmd: 'totally.made.up', args: {} });
  assert.deepEqual(term.result, { reached: 'the extension' });
  delete ext.handlers['totally.made.up'];
});

test('a phone view\'s run (phone~phonesite.org): its phone twin\'s mods only, not its site\'s desktop mods or another twin\'s', { timeout: 120000 }, async () => {
  const { runs } = await world();
  const { box } = runs.phone;
  const own = await forge(box, 'mod.code', { id: 'phone~phonesite.org/bar' });
  assert.equal(own.ok, true, own.error);
  assert.match(own.result.code, /the phone view's own/);
  assert.equal((await forge(box, 'mod.diff', { id: 'phone~phonesite.org/bar' })).ok, true);
  for (const cmd of ['mod.code', 'mod.diff']) {
    for (const id of ['phonesite.org/desk', 'phone~victim.com/bar', 'victim.com/secret', 'all-sites/dark', 'phone~attacker.com/bar']) refusedAsAnothers(await forge(box, cmd, { id }), `${cmd} ${id} from the phone view's run`);
  }
  const mods = await forge(box, 'mods', {});
  assert.deepEqual(idsOf(mods), ['phone~phonesite.org/bar']);
  assert.ok(!JSON.stringify(mods).includes(SECRET));
});

test('a sensitive site of its own (mail.example.com) and its parent (example.com): each run its own mods only', { timeout: 120000 }, async () => {
  const { runs } = await world();
  // the parent's run: the sensitive site's mods are another site's; a plain part of the parent is its own
  const parent = runs.parent.box;
  for (const cmd of ['mod.code', 'mod.diff']) {
    const r = await forge(parent, cmd, { id: 'mail.example.com/inbox' });
    assert.equal(r.ok, false, `${cmd} mail.example.com/inbox from example.com's run`);
    assert.match(r.error, /another site's/);
    assert.ok(!JSON.stringify(r).includes('INBOX-MARK'));
  }
  assert.match((await forge(parent, 'mod.code', { id: 'example.com/plain' })).result.code, /PARENT-MARK/);
  assert.equal((await forge(parent, 'mod.code', { id: 'docs.example.com/docs' })).ok, true);
  const pm = await forge(parent, 'mods', {});
  assert.deepEqual(idsOf(pm), ['docs.example.com/docs', 'example.com/plain']);
  assert.ok(!JSON.stringify(pm).includes('INBOX-MARK') && !JSON.stringify(pm).includes('mail.example.com'));
  assert.ok(!(await forge(parent, 'ping', {})).result.mods.includes('mail.example.com/inbox'));

  // the sensitive site's run: its own; the parent's and the parent's other parts are another site's
  const sens = runs.sensitive.box;
  assert.match((await forge(sens, 'mod.code', { id: 'mail.example.com/inbox' })).result.code, /INBOX-MARK/);
  for (const cmd of ['mod.code', 'mod.diff']) {
    for (const id of ['example.com/plain', 'docs.example.com/docs', 'victim.com/secret']) {
      const r = await forge(sens, cmd, { id });
      assert.equal(r.ok, false, `${cmd} ${id} from mail.example.com's run`);
      assert.match(r.error, /another site's/);
      assert.ok(!JSON.stringify(r).includes('PARENT-MARK') && !JSON.stringify(r).includes(SECRET));
    }
  }
  const sm = await forge(sens, 'mods', {});
  assert.deepEqual(idsOf(sm), ['mail.example.com/inbox']);
  assert.ok(!JSON.stringify(sm).includes('PARENT-MARK'));
  assert.deepEqual((await forge(sens, 'ping', {})).result.mods, ['all-sites/dark', 'mail.example.com/inbox']);
});

test('the side panel (no run) reads every mod as before, and the run\'s own trif still works', { timeout: 120000 }, async () => {
  const { home, ext, runs } = await world();
  const code = await ask(ext, 'mod.code', { id: 'victim.com/secret' });
  assert.equal(code.ok, true, code.error);
  assert.ok(code.result.code.includes(SECRET));
  const diff = await ask(ext, 'mod.diff', { id: 'victim.com/secret' });
  assert.equal(diff.ok, true, diff.error);
  assert.equal((await ask(ext, 'mod.code', { id: 'phone~victim.com/bar' })).ok, true);
  assert.equal((await ask(ext, 'mod.code', { id: 'mail.example.com/inbox' })).ok, true);
  // the user's terminal, too
  assert.ok((await sockRequest(ext.sock, { id: 'c', cmd: 'mod.code', args: { id: 'victim.com/secret' } })).result.code.includes(SECRET));

  // `trif` inside the run, through its mailbox: status (ping and the extension's status), tabs, and a delete
  // held to its site as it was
  const env = runs.desktop.env;
  const st = await runCli(['status'], { home, env });
  assert.equal(st.code, 0, st.stderr);
  assert.match(st.stdout, /helper +running/);
  assert.match(st.stdout, /attacker\.com\/mine +registered/);
  const tabs = await runCli(['tabs', '--json'], { home, env });
  assert.equal(tabs.code, 0, tabs.stderr);
  assert.equal(JSON.parse(tabs.stdout).scope, 'attacker.com');
  const del = await runCli(['delete', 'victim.com/secret'], { home, env });
  assert.notEqual(del.code, 0);
  assert.match(del.stderr + del.stdout, /can only delete mods of attacker\.com/);
  assert.ok(fs.existsSync(path.join(home, 'sites', 'victim.com', 'secret.js')));
});

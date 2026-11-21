'use strict';
// The phone link, step 7 (docs/PHONE-LINK.md section 6, item 4): `trif phone page | try | screenshot`, the
// agent's way to the page on the phone. The real Store, Server, Runs and Remote in this process (a temp
// workspace, a fake keychain, 127.0.0.1 at a port the system picks), a stand-in phone that answers
// `tool.request`, and a stand-in agent that runs the real `trif phone …` (helper/cli.js) through the run's
// mailbox, as a real agent's command would. The mailbox is answered here as host.js onClientLine answers it:
// remoteRefusal, then remoteCommand with Remote.tool.
// What is proven here:
//   - each command becomes one tool.request on the session that follows the run, and the phone's answer is
//     what the command prints; its screenshot is a file of the run's, gone when the run ends;
//   - `try` sends a draft of the run's own phone twin from its working copy, and nothing else: not a desktop
//     mod, not another site's twin, not a path, not through a link;
//   - only the session that was asked can answer; another phone's answer, and a second one, are dropped;
//   - no phone, a phone that goes away, a phone that doesn't answer: each fails in words, none hangs;
//   - outside a phone run, and in a helper without the link, the commands are refused: by the two functions,
//     and by the real helper (host.js in a temp HOME, a fake extension), where nothing of them reaches the
//     extension.

const test = require('./on-windows')(__filename);
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { FakeExtension, runCli, tempDir, waitFor } = require('./fake-extension');
const { standInAgent } = require('./phone-link-agent');
const { makeFakeKeychain } = require('./fake-keychain');
const { PhoneClient } = require('./phone-link-client');

// Before runs.js is loaded: this process is the helper of a temp workspace (never ~/.trif).
const { home, go, phoneCalls } = standInAgent('wm-pltool-');

const P = require('../helper/lib/paths');
const { Runs } = require('../helper/lib/runs');
const { Store } = require('../helper/lib/phonelink/store');
const { Server } = require('../helper/lib/phonelink/server');
const { Remote } = require('../helper/lib/phonelink/remote');
const { generateKeyPair, keyId } = require('../helper/lib/phonelink/noise');
const R = require('../helper/lib/phonelink/remoterun');

const sites = path.join(home, 'sites');
const chain = makeFakeKeychain(path.join(home, 'keychain'));
const store = new Store(home, { env: { ...chain.env }, name: 'Test Mac' });
const lines = [];
const server = new Server(store, { version: '9.9.9', host: '127.0.0.1', port: 0, firstMessageMs: 500, log: (l) => lines.push(l) });
let remote = null;
const live = new Map(); // (runId → the helper's run, as the mailbox last saw it)
const runs = new Runs({
  getWorkspace: () => P.workspace(home),
  logger: { info() {}, debug() {}, error() {}, warn() {} },
  onEvent: (runId, ev) => { remote.onEvent(runId, ev); },
  // (host.js onRunRequest and onClientLine, for a run's request: the same two functions decide)
  onRequest: (run, line, respond) => {
    const req = JSON.parse(line);
    live.set(run.id, run);
    const answer = (o) => respond(JSON.stringify({ id: req.id, ...o }));
    const refused = R.remoteRefusal(run, req.cmd, req.args);
    if (refused) return answer({ ok: false, error: refused });
    const viaPhone = R.remoteCommand(run, req.cmd, req.args, (r, c, a) => remote.tool(r, c, a));
    if (viaPhone) { viaPhone.then((result) => answer({ ok: true, result }), (e) => answer({ ok: false, error: e.message })); return undefined; }
    return answer({ ok: false, error: 'this test answers only `trif phone`' });
  },
});
remote = new Remote(store, server, runs, { home, log: (l) => lines.push(l), agent: () => ({ id: 'claude', name: 'The agent', model: null }) });

const phones = [];
let computerKey = null;
test.before(async () => {
  await store.setOn(true);
  await server.start();
  remote.start();
  computerKey = (await store.keys()).publicKey;
});
test.after(async () => {
  for (const p of phones) { try { await p.close(); } catch { /* closed */ } }
  await runs.stopAll(300);
  remote.stop();
  store.pairStop();
  await server.stop();
  try { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(`${home}-private`, { recursive: true, force: true }); } catch { /* left */ }
});

const HELLO = { t: 'hello', app: '1.0', device: { name: 'iPhone', width: 393, height: 852 } };
async function connect(keys, name) {
  const secret = name ? store.pairStart().secret : undefined;
  const port = await server.sync();
  const phone = await PhoneClient.connect({ port, computerKey, keys, name: name || 'again', pair: secret });
  phones.push(phone);
  phone.hello = await phone.request(HELLO);
  phone.id = keyId(keys.publicKey);
  return phone;
}
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('the page with the draft')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('the page now')]);
const startMsg = (site, prompt) => ({ t: 'run.start', url: `https://${site}/home`, prompt, page: '<main>the page</main>' });
const ended = (runId) => waitFor(() => { const r = remote.records.get(runId); return r && r.done; }, { timeout: 30000, message: `run ${runId} to end` });
async function start(phone, site, prompt) {
  const a = await phone.request(startMsg(site, prompt));
  assert.equal(a.t, 'run.started', JSON.stringify(a));
  return a.runId;
}
/** The `trif phone` commands the agent ran since `from`, once there are `n` of them. */
async function printed(from, n) {
  await waitFor(() => phoneCalls().length >= from + n, { timeout: 30000, message: `${n} trif phone command(s)` });
  return phoneCalls().slice(from);
}

const keysA = generateKeyPair();
const keysB = generateKeyPair();
let A = null;
let B = null;

test('trif phone try, page and screenshot: one tool.request each, the phone\'s answer printed, its screenshot a file of the run\'s', async () => {
  A = await connect(keysA, 'Tim\'s iPhone');
  A.onTool = (m) => (m.tool === 'try_mod' ? { text: 'The bar is gone.\nErrors: none', shot: JPEG.toString('base64') }
    : m.tool === 'read_page' ? { text: '<nav>\n\t<a href="/home">Home</a>\n</nav>\u0007' }
      : { shot: PNG.toString('base64') });
  const before = phoneCalls().length;
  const runId = await start(A, 'x.com', 'WRITE PHONE[try bottom-bar] PHONE[page nav a --limit 3] PHONE[page] PHONE[screenshot] PHONE[try sites/phone~x.com/bottom-bar.js]');
  const [tried, some, page, shot, again] = await printed(before, 5);
  await ended(runId);

  // What the phone was asked: this run's, the app's three tools, the draft's code from the working copy.
  assert.deepEqual(A.tools.map((m) => [m.t, m.runId, m.tool]), [['tool.request', runId, 'try_mod'], ['tool.request', runId, 'read_page'], ['tool.request', runId, 'read_page'], ['tool.request', runId, 'screenshot'], ['tool.request', runId, 'try_mod']]);
  assert.equal(new Set(A.tools.map((m) => m.id)).size, 5);
  for (const m of A.tools) assert.match(m.id, /^t[0-9a-f]{16}$/);
  assert.equal(A.tools[0].input.id, 'phone~x.com/bottom-bar');
  assert.match(A.tools[0].input.code, /^\/\/ ==WebMod==\n\/\/ @name bottom bar\n/);
  assert.deepEqual(Object.keys(A.tools[0].input).sort(), ['code', 'id']);
  assert.deepEqual(A.tools[1].input, { selector: 'nav a', limit: 3 });
  assert.deepEqual(A.tools[2].input, {});
  assert.deepEqual(A.tools[3].input, {});
  assert.deepEqual(A.tools[4].input, A.tools[0].input); // (the same mod, named by its file)

  // What the agent's command printed: the phone's words (lines and tabs kept, other control characters not),
  // and the screenshot's place in the run's screenshots folder.
  assert.equal(tried.status, 0, tried.stderr);
  assert.match(tried.stdout, /^The bar is gone\.\nErrors: none\nscreenshot: .+\/phone-now-r[0-9a-z]+-1\.jpg\n$/);
  assert.equal(tried.shot.head, JPEG.subarray(0, 40).toString('latin1'));
  assert.equal(tried.shot.mode, 0o600);
  assert.equal(some.stdout, '<nav>\n\t<a href="/home">Home</a>\n</nav> \n');
  assert.equal(page.status, 0);
  assert.equal(shot.status, 0);
  assert.match(shot.stdout, /^screenshot: .+\/phone-now-r[0-9a-z]+-2\.png\n$/);
  assert.equal(shot.shot.head, PNG.subarray(0, 40).toString('latin1'));
  assert.match(again.stdout, /-3\.jpg\n$/);

  // The screenshots went with the run, as the page copy does; nothing waits for an answer.
  for (const c of [tried, shot, again]) assert.equal(fs.existsSync(c.shot.file), false, c.shot.file);
  assert.equal(remote.tools.size, 0);
  // The run's result is its phone twin's mods (the site's and a part of the site's), as without the commands.
  const result = await A.next((m) => m.t === 'run.result' && m.runId === runId, { timeout: 15000 });
  assert.deepEqual(result.mods.map((m) => m.id).sort(), ['phone~m.x.com/part', 'phone~x.com/bottom-bar']);
  await A.request({ t: 'run.ack', runId });
});

test('try sends only a draft of the run\'s own phone twin; what the phone couldn\'t do is the command\'s failure', async () => {
  fs.mkdirSync(path.join(sites, 'x.com'), { recursive: true });
  fs.writeFileSync(path.join(sites, 'x.com', 'mine.js'), '// the user\'s desktop mod');
  A.tools.length = 0;
  A.onTool = (m) => (m.tool === 'try_mod' ? { text: 'The mod threw: nav is null', error: true } : { text: 'ok', shot: 'not an image' });
  const before = phoneCalls().length;
  const runId = await start(A, 'x.com', 'WRITE PHONE[try x.com/mine] PHONE[try phone~other.example/theirs] PHONE[try ../../../etc/passwd] PHONE[try nothing-here] PHONE[try] PHONE[try bottom-bar] PHONE[screenshot] PHONE[page --limit 0]');
  const [desktop, other, dots, none, bare, threw, noImage, limit] = await printed(before, 8);
  await ended(runId);

  assert.equal(desktop.status, 1);
  assert.match(desktop.stderr, /can try only phone mods of its own site \(sites\/phone~x\.com\/\), not one in sites\/x\.com\//);
  assert.match(other.stderr, /not one in sites\/phone~other\.example\//);
  assert.equal(dots.status, 1);
  assert.match(dots.stderr, /usage: trif phone try <mod>/);
  assert.match(none.stderr, /there is no sites\/phone~x\.com\/nothing-here\.js in your working folder/);
  assert.equal(bare.status, 1);
  assert.equal(limit.status, 1);
  // The phone was asked for the two that could be asked, and nothing of the refused ones left the computer.
  assert.deepEqual(A.tools.map((m) => m.tool), ['try_mod', 'screenshot']);
  assert.equal(threw.status, 1);
  assert.equal(threw.stdout, 'The mod threw: nav is null\n');
  assert.equal(noImage.status, 0);
  assert.match(noImage.stdout, /^ok\n\(the phone sent a screenshot that isn't a JPEG or a PNG: not saved\)\n$/);
  await A.request({ t: 'run.ack', runId });
});

test('readDraft: the run\'s own twin in its working copy, never through a link, never too big', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-pldraft-'));
  try {
    const stage = path.join(dir, 'sites');
    fs.mkdirSync(path.join(stage, 'phone~x.com'), { recursive: true });
    fs.mkdirSync(path.join(stage, 'phone~m.x.com'));
    fs.mkdirSync(path.join(stage, 'x.com'));
    fs.writeFileSync(path.join(stage, 'phone~x.com', 'a.js'), 'A');
    fs.writeFileSync(path.join(stage, 'phone~m.x.com', 'part.js'), 'PART');
    fs.writeFileSync(path.join(stage, 'x.com', 'secret.js'), 'SECRET');
    fs.writeFileSync(path.join(dir, 'outside.js'), 'OUTSIDE');
    fs.symlinkSync(path.join(dir, 'outside.js'), path.join(stage, 'phone~x.com', 'link.js'));
    fs.symlinkSync(path.join(stage, 'x.com'), path.join(stage, 'phone~www.x.com'));
    fs.writeFileSync(path.join(stage, 'phone~x.com', 'big.js'), Buffer.alloc(R.DRAFT_MAX + 1, 0x20));
    fs.mkdirSync(path.join(stage, 'phone~x.com', 'folder.js'));
    const run = { scope: 'phone~x.com', splits: [], stage: { sites: stage } };
    assert.deepEqual(R.readDraft(run, 'a'), { id: 'phone~x.com/a', code: 'A' });
    assert.deepEqual(R.readDraft(run, 'phone~x.com/a.js'), { id: 'phone~x.com/a', code: 'A' });
    assert.deepEqual(R.readDraft(run, `${stage}/phone~x.com/a.js`), { id: 'phone~x.com/a', code: 'A' });
    assert.deepEqual(R.readDraft(run, 'phone~m.x.com/part'), { id: 'phone~m.x.com/part', code: 'PART' }); // (a part of the site: its own too)
    assert.throws(() => R.readDraft(run, 'link'), (e) => e.code === 'no-mod');
    assert.throws(() => R.readDraft(run, 'phone~www.x.com/secret'), (e) => e.code === 'no-mod' || e.code === 'bad-request');
    assert.throws(() => R.readDraft(run, 'x.com/secret'), (e) => e.code === 'bad-request');
    assert.throws(() => R.readDraft(run, 'folder'), (e) => e.code === 'no-mod');
    assert.throws(() => R.readDraft(run, 'big'), (e) => e.code === 'too-big');
    for (const bad of ['', '..', '.hidden', '_off', 'a/b/c', 'phone~x.com/../x.com/secret', '../outside', null, 7]) {
      assert.throws(() => R.readDraft(run, bad), (e) => e.code === 'bad-request', String(bad));
    }
    assert.throws(() => R.readDraft({ ...run, stage: null }, 'a'), (e) => e.code === 'no-mod');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('only the session that was asked can answer: another phone\'s answer and a second one are dropped', async () => {
  B = await connect(keysB, 'Another iPhone');
  A.tools.length = 0;
  A.onTool = () => null; // (asked, not answered yet)
  const before = phoneCalls().length;
  const runId = await start(A, 'x.com', 'PHONE[page main]');
  await waitFor(() => A.tools.length === 1, { timeout: 15000, message: 'the tool.request' });
  const id = A.tools[0].id;
  // Another paired phone names the request's id: not its session's, so nothing happens and nothing is said.
  B.send({ t: 'tool.result', id, text: 'from another phone' });
  B.send({ t: 'tool.result', id: 't0000000000000000', text: 'an id nobody made' });
  assert.equal((await B.request({ t: 'ping' })).t, 'pong');
  assert.equal(B.kept.length, 0);
  assert.equal(remote.tools.size, 1);
  assert.equal(phoneCalls().length, before);
  // The phone that was asked answers; its second answer is dropped.
  A.send({ t: 'tool.result', id, text: 'from the phone that was asked' });
  A.send({ t: 'tool.result', id, text: 'a second answer' });
  const [page] = await printed(before, 1);
  assert.equal(page.stdout, 'from the phone that was asked\n');
  await ended(runId);
  assert.equal(remote.tools.size, 0);
  await A.request({ t: 'run.ack', runId });
});

test('a phone that doesn\'t answer: the command fails after its time, and the run goes on', async () => {
  A.tools.length = 0;
  A.onTool = () => null;
  remote.toolMs = 400;
  try {
    const before = phoneCalls().length;
    const runId = await start(A, 'x.com', 'PHONE[screenshot]');
    const [shot] = await printed(before, 1);
    assert.equal(shot.status, 1);
    assert.match(shot.stderr, /the phone didn't answer in \d+ seconds/);
    await ended(runId);
    assert.equal(remote.tools.size, 0);
    // Its answer, late: dropped.
    A.send({ t: 'tool.result', id: A.tools[0].id, text: 'late' });
    assert.equal((await A.request({ t: 'ping' })).t, 'pong');
    await A.request({ t: 'run.ack', runId });
  } finally { remote.toolMs = 60000; }
});

test('a phone that goes away: the waiting command fails at once, the next one isn\'t sent, the run finishes and is kept', async () => {
  A.tools.length = 0;
  A.onTool = () => { A.close(); return null; }; // (the app is suspended as it is asked)
  const before = phoneCalls().length;
  const runId = await start(A, 'y.com', 'WRITE PHONE[try bottom-bar] PHONE[screenshot]'); // (a site no run here has written for)
  const [tried, shot] = await printed(before, 2);
  assert.equal(tried.status, 1);
  assert.match(tried.stderr, /the phone went away before it answered: the phone isn't connected right now/);
  assert.equal(shot.status, 1);
  assert.match(shot.stderr, /trif phone: the phone isn't connected right now .* finish from what you have/);
  await ended(runId);
  assert.equal(remote.tools.size, 0);
  // The phone comes back: the run is there for it, with the mod it wrote.
  A = await connect(keysA);
  assert.deepEqual(A.hello.pending.filter((p) => p.runId === runId).map((p) => p.done), [true]);
  const resumed = await A.request({ t: 'run.resume', runId });
  assert.equal(resumed.done, true);
  const result = await A.next((m) => m.t === 'run.result' && m.runId === runId, { timeout: 15000 });
  assert.ok(result.mods.some((m) => m.id === 'phone~y.com/bottom-bar'));
  await A.request({ t: 'run.ack', runId });
});

test('a run whose phone came back is asked on the session that resumed it', async () => {
  const first = A;
  first.onTool = () => null;
  const before = phoneCalls().length;
  const runId = await start(first, 'x.com', 'PAUSE:resumed PHONE[page]');
  await first.next((m) => m.t === 'run.event' && m.runId === runId, { timeout: 15000 });
  await first.close();
  A = await connect(keysA);
  A.onTool = (m) => ({ text: `asked on the new session for ${m.runId}` });
  assert.equal((await A.request({ t: 'run.resume', runId })).t, 'ok');
  go('resumed');
  const [page] = await printed(before, 1);
  assert.equal(page.stdout, `asked on the new session for ${runId}\n`);
  assert.equal(first.tools.length, 0);
  await ended(runId);
  await A.request({ t: 'run.ack', runId });
});

test('outside a phone run, and in a helper without the link, the commands are refused; a run\'s screenshots are capped', async () => {
  const asked = [];
  const tool = (...a) => { asked.push(a); return Promise.resolve({ text: 'x' }); };
  // Not `trif phone`: not this function's.
  assert.equal(R.remoteCommand({ remote: {} }, 'tabs', {}, tool), null);
  assert.equal(R.remoteCommand(null, 'mods', {}, tool), null);
  // A side-panel run, the phone view's run, a terminal: refused, and the phone link isn't asked.
  for (const run of [null, { id: 'r1', scope: 'x.com' }, { id: 'r2', scope: 'phone~x.com', remote: null }]) {
    for (const cmd of R.REMOTE_TOOLS.keys()) {
      await assert.rejects(R.remoteCommand(run, cmd, {}, tool), (e) => e.code === 'not-remote' && /isn't one/.test(e.message));
    }
  }
  assert.equal(asked.length, 0);
  // A phone run in a helper that doesn't own the link (host.js before it is started there).
  await assert.rejects(R.remoteCommand({ id: 'r3', remote: {} }, 'remote.page', {}, null), (e) => e.code === 'away');
  // A phone run may use them (they never reach the extension: host.js answers them before it).
  for (const cmd of R.REMOTE_TOOLS.keys()) {
    assert.equal(R.remoteRefusal({ remote: {}, scope: 'phone~x.com' }, cmd, {}), null);
    assert.ok(R.REMOTE_COMMANDS.has(cmd));
  }
  // Remote.tool itself: a run it has no record of (another helper's, an ended one) is nobody's.
  await assert.rejects(remote.tool({ id: 'rnotarun', remote: { phone: { id: A.id } } }, 'remote.page', {}), (e) => e.code === 'not-remote');
  await assert.rejects(remote.tool({ id: 'r1' }, 'remote.page', {}), (e) => e.code === 'not-remote');

  // The screenshots a phone sends back for one run: TOOL_SHOTS at most, the oldest deleted.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-plshots-'));
  try {
    const run = { id: 'rshots', screenshots: dir, screenshotsReal: dir, remote: { files: { page: null, shot: null } } };
    assert.equal(R.writeToolShot(run, Buffer.from('not an image')), null);
    assert.equal(R.writeToolShot({ ...run, remote: null }, JPEG), null);
    for (let i = 0; i < R.TOOL_SHOTS + 5; i++) assert.ok(R.writeToolShot(run, i % 2 ? JPEG : PNG));
    assert.equal(fs.readdirSync(dir).length, R.TOOL_SHOTS);
    assert.equal(fs.existsSync(path.join(dir, 'phone-now-rshots-1.png')), false);
    assert.equal(fs.existsSync(path.join(dir, `phone-now-rshots-${R.TOOL_SHOTS + 5}.png`)), true);
    R.removeRemoteFiles(run);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the real helper refuses the commands from anything but a phone run, and the extension never sees them', async () => {
  const hostHome = tempDir('wm-plhost-');
  const ext = new FakeExtension({ home: hostHome });
  try {
    await ext.waitForSocket();
    const ask = (msg) => new Promise((resolve, reject) => {
      const s = net.connect(ext.sock);
      let buf = '';
      const t = setTimeout(() => { s.destroy(); reject(new Error('no answer from the helper')); }, 10000);
      s.setEncoding('utf8');
      s.on('connect', () => s.write(`${JSON.stringify(msg)}\n`));
      s.on('data', (d) => { buf += d; if (buf.includes('\n')) { clearTimeout(t); s.destroy(); resolve(JSON.parse(buf.slice(0, buf.indexOf('\n')))); } });
      s.on('error', (e) => { clearTimeout(t); reject(e); });
    });
    // A terminal (no run's token): each is refused by the helper itself.
    for (const [cmd, args] of [['remote.page', { selector: 'main' }], ['remote.try', { id: 'bottom-bar' }], ['remote.screenshot', {}]]) {
      const r = await ask({ id: cmd, cmd, args });
      assert.equal(r.ok, false, cmd);
      assert.match(r.error, /in a run they started from the phone: this isn't one/);
    }
    // A token that is no run's: as for every command.
    assert.match((await ask({ id: 't', cmd: 'remote.page', args: {}, token: 'not-a-token' })).error, /this agent run has ended/);
    // The command itself, in a terminal: says where it works, and asks nobody.
    const cli = await runCli(['phone', 'screenshot'], { home: hostHome });
    assert.equal(cli.code, 1);
    assert.match(cli.stderr, /works inside a run the user started from their phone/);
    // Still answering, and nothing of it went to the extension.
    assert.equal((await ask({ id: 'p', cmd: 'ping' })).ok, true);
    assert.deepEqual(ext.messages.filter((m) => m.type === 'request' && /^remote\./.test(m.cmd)), []);
  } finally {
    await ext.close();
    try { fs.rmSync(hostHome, { recursive: true, force: true }); fs.rmSync(`${hostHome}-private`, { recursive: true, force: true }); } catch { /* left */ }
  }
});

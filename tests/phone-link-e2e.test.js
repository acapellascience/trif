'use strict';
// The phone link, end to end (docs/PHONE-LINK.md "Proof"): one story with a stand-in phone
// (tests/phone-link-client.js) against the real helper, helper/host.js run as a browser runs it, in a temp
// workspace, with a fake extension as the side panel, a fake keychain, a stand-in dns-sd (the real one never
// runs: it would announce on the Wi-Fi), the listener on 127.0.0.1 alone at a port the system picks, and a
// stand-in agent (tests/phone-link-agent.js: no model, no paid call) that runs the real `trif` commands
// through the run's mailbox. The story:
//   - the panel turns the link on and shows a code; the phone pairs with what the code says;
//   - the phone asks for a mod with its page copy and a screenshot; the agent writes all over its working
//     folder, tries its draft on the phone and gets the phone's answer, and asks for this computer's tabs,
//     which a phone run has none of; the phone gets the steps, numbered, then the mods of its site's phone
//     twin; nothing else in the mods folder changed; the extension was asked nothing and shown no step;
//     the page copy and the screenshots are in no file once the run has ended;
//   - the phone goes away in the middle of a second run: the agent is told so in words, the computer
//     finishes and keeps the result; the phone comes back with its keys, is told what waits, and gets the
//     steps it missed and the result; what it says it has is deleted;
//   - the panel removes the phone: its connection is closed, what was kept for it is deleted, and from then
//     on it gets not one byte, while another paired phone goes on;
//   - off: nothing listens, nothing is announced, no agent and no dns-sd is left behind.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { FakeExtension, tempDir, waitFor } = require('./fake-extension');
const { standInAgent } = require('./phone-link-agent');
const { makeFakeKeychain } = require('./fake-keychain');
const { makeStandIn } = require('./fake-dns-sd');
const { PhoneClient } = require('./phone-link-client');
const { generateKeyPair, keyId } = require('../helper/lib/phonelink/noise');

// The temp workspace with the stand-in agent as its `claude` (the helper is a process of its own here, with
// the same variables: FakeExtension's testEnv plus `env` below).
const { home, bin, calls, go, phoneCalls } = standInAgent('wm-ple-');
const extra = tempDir('wm-plex-');
const priv = `${home}-private`;
const sites = path.join(home, 'sites');
const chain = makeFakeKeychain(path.join(extra, 'keychain'));
const standIn = makeStandIn(path.join(extra, 'bin'));
const env = { ...chain.env, TRIF_DNS_SD: standIn.bin, TRIF_AGENT_KILL_GRACE_MS: '300' };
const phones = [];
let ext = null;

let asked = 0;
/** A request as the side panel's (the extension's own connection to its helper). */
async function panel(cmd, args = {}) {
  const id = `p${++asked}`;
  ext.send({ type: 'request', id, cmd, args });
  const r = await ext.next((m) => m.type === 'response' && m.id === id, { timeout: 15000 });
  if (!r.ok) throw new Error(r.error);
  return r.result;
}
/** Whether anything accepts a connection on 127.0.0.1 at this port. */
function listening(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}
const gone = (pid) => { try { process.kill(pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; } };
/** Every file under a folder: [path, text]. */
function everyFile(dir, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) everyFile(p, out);
    else if (d.isFile()) out.push([p, fs.readFileSync(p, 'latin1')]);
  }
  return out;
}
/** The mods folder: relative path → text. */
function tree() {
  const out = {};
  for (const [p, text] of everyFile(sites)) out[path.relative(sites, p)] = text;
  return out;
}
const HELLO = { t: 'hello', app: '1.0', device: { name: 'iPhone', width: 393, height: 852 } };
async function connect(port, computerKey, keys, { name, pair } = {}) {
  const phone = await PhoneClient.connect({ port, computerKey, keys, name: name || 'again', pair });
  phones.push(phone);
  phone.hello = await phone.request(HELLO);
  return phone;
}
const qrOf = (qr) => { const u = new URL(qr); return { key: Buffer.from(u.searchParams.get('k'), 'base64url'), secret: u.searchParams.get('s') }; };
const isEvent = (runId) => (m) => m.t === 'run.event' && m.runId === runId;
/** The run's events from the phone's side, up to and with the first one that fits (`done` when none is given). */
async function upTo(phone, runId, fits = (e) => e.kind === 'done', got = []) {
  for (;;) {
    const m = await phone.next(isEvent(runId), { timeout: 30000 });
    got.push(m);
    if (fits(m.event)) return got;
  }
}
/** The `trif` commands the agent ran since `from`, once there are `n` of them. */
async function printed(from, n) {
  await waitFor(() => phoneCalls().length >= from + n, { timeout: 30000, message: `${n} trif command(s) of the agent's` });
  return phoneCalls().slice(from);
}
const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(sites, rel)), { recursive: true }); fs.writeFileSync(path.join(sites, rel), text); };

// What the phone sends of the page, and what it answers the agent with: none of it may stay on the computer.
const PAGE = '<main>THE-PAGE-AS-THE-PHONE-SHOWED-IT</main>';
const SHOT = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('THE-PHONES-SCREENSHOT')]);
const TRIED = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('THE-PAGE-WITH-THE-DRAFT')]);
const NOW = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('THE-PAGE-JUST-NOW')]);
const SECRETS = ['THE-PAGE-AS-THE-PHONE-SHOWED-IT', 'THE-PHONES-SCREENSHOT', 'THE-PAGE-WITH-THE-DRAFT', 'THE-PAGE-JUST-NOW'];

test.after(async () => {
  for (const p of phones) { try { await p.close(); } catch { /* closed */ } }
  if (ext) { try { await ext.close(); } catch { /* gone */ } }
  for (const c of standIn.calls()) { try { process.kill(c.pid, 'SIGKILL'); } catch { /* gone */ } }
  for (const dir of [home, priv, extra]) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* left */ } }
});

test('the phone link end to end: pair, a run with a try on the phone, its result, a drop and a resume, remove', async () => {
  // The user's desktop mods, and a phone mod from before.
  put('x.com/mine.js', '// the user\'s desktop mod');
  put('x.com/keep.js', '// another desktop mod');
  put('all-sites/dark.js', '// for every site');
  put('phone~other.example/theirs.js', '// another site\'s phone mod');

  ext = new FakeExtension({ home, env });
  await ext.waitForSocket();
  ext.hello();

  // ---- The panel: on, Connect a phone. The phone: what the code says.
  assert.equal((await panel('phone.status')).on, false);
  const on = await panel('phone.on');
  const window = await panel('phone.pair.start');
  const { key: computerKey, secret } = qrOf(window.qr);
  const port = window.port;
  assert.equal(await listening(port), true);
  const announced = await waitFor(() => standIn.calls()[0], { message: 'the announcement' });
  assert.deepEqual(announced.argv.slice(2), ['_trif._tcp', 'local', String(port), 'v=1', `id=${on.id}`]);

  const keysA = generateKeyPair();
  const idA = keyId(keysA.publicKey);
  let A = await connect(port, computerKey, keysA, { name: 'Tim\'s iPhone', pair: secret });
  assert.equal(A.hello.t, 'hello');
  assert.equal(typeof A.hello.agent.name, 'string', 'the phone is told which agent will work for it');
  assert.ok(A.hello.agent.name.length > 0);
  assert.deepEqual(A.hello.pending, []);
  await ext.next((m) => m.type === 'phoneLink' && m.status.phones.length === 1 && !m.status.pairing);
  assert.deepEqual((await panel('phone.status')).phones.map((p) => [p.id, p.name]), [[idA, 'Tim\'s iPhone']]);

  // ---- A run from the phone: the page copy, a screenshot, and words that make the stand-in agent write all
  // over its working folder, try its draft on the phone, ask for this computer's tabs, and look once more.
  A.onTool = (m) => (m.tool === 'try_mod' ? { text: 'The bar is at the bottom.\nErrors: none', shot: TRIED.toString('base64') }
    : m.tool === 'screenshot' ? { shot: NOW.toString('base64') } : { text: 'not asked in this test', error: true });
  const before = tree();
  const mark = ext.messages.length;
  const ran = phoneCalls().length;
  const started = await A.request({
    t: 'run.start', url: 'https://x.com/home', page: PAGE, shot: SHOT.toString('base64'), chat: 'chat-1',
    prompt: 'WRITE a bottom bar PHONE[try bottom-bar] CLI[screenshot] CLI[text] CLI[tabs] PHONE[screenshot]',
  });
  assert.equal(started.t, 'run.started', JSON.stringify(started));
  const runId = started.runId;
  const events = await upTo(A, runId);
  assert.deepEqual(events.map((m) => m.n), events.map((_, i) => i + 1), 'numbered from 1, none missing');
  assert.ok(events.some((m) => m.event.kind === 'text' && /Done\./.test(JSON.stringify(m.event))), JSON.stringify(events.map((m) => m.event.kind)));
  assert.equal(events[events.length - 1].event.ok, true, JSON.stringify(events));

  // The result: the phone twin's mods, as code for the phone's own approval screen.
  const result = await A.next((m) => m.t === 'run.result' && m.runId === runId);
  assert.deepEqual(result.mods.map((m) => [m.id, m.name]).sort(), [['phone~m.x.com/part', 'a part of the site'], ['phone~x.com/bottom-bar', 'bottom bar']]);
  assert.match(result.mods.find((m) => m.id === 'phone~x.com/bottom-bar').code, /^\/\/ ==WebMod==\n\/\/ @name bottom bar\n/);
  assert.deepEqual(result.removed, []);

  // The agent was given the phone's page and screenshot as files of its run, and the page's address and width.
  const call = await waitFor(() => calls().find((c) => c.prompt.includes('WRITE a bottom bar')), { message: 'the agent\'s call' });
  assert.match(call.context, /"https:\/\/x\.com\/home" on the phone, 393 px wide/);
  assert.deepEqual(Object.keys(call.seen).sort(), [`phone-page-${runId}.txt`, `phone-screenshot-${runId}.jpg`]);
  assert.equal(call.seen[`phone-page-${runId}.txt`].head, PAGE.slice(0, 40));
  assert.equal(call.seen[`phone-screenshot-${runId}.jpg`].head, SHOT.subarray(0, 40).toString('latin1'));

  // Try on the phone: the draft from the run's working copy went to the phone, the phone's words and its
  // screenshot came back to the agent's command.
  const [tried, shot1, text1, tabs1, looked] = await printed(ran, 5);
  assert.deepEqual(A.tools.map((m) => [m.t, m.runId, m.tool]), [['tool.request', runId, 'try_mod'], ['tool.request', runId, 'screenshot']]);
  assert.equal(A.tools[0].input.id, 'phone~x.com/bottom-bar');
  assert.match(A.tools[0].input.code, /^\/\/ ==WebMod==\n\/\/ @name bottom bar\n/);
  assert.equal(tried.status, 0, tried.stderr);
  assert.match(tried.stdout, /^The bar is at the bottom\.\nErrors: none\nscreenshot: .+\.jpg\n$/);
  assert.equal(tried.shot.head, TRIED.subarray(0, 40).toString('latin1'));
  assert.equal(tried.shot.mode, 0o600);
  assert.equal(looked.status, 0, looked.stderr);
  assert.match(looked.stdout, /^screenshot: .+\.png\n$/);
  assert.equal(looked.shot.head, NOW.subarray(0, 40).toString('latin1'));

  // This computer's tabs: a phone run has none. Each command was refused by the helper, in words, at once.
  for (const c of [shot1, text1, tabs1]) {
    assert.equal(c.cli, true);
    assert.notEqual(c.status, 0, `trif ${c.args.join(' ')}`);
    assert.match(c.stdout + c.stderr, /this run is for the user's phone: the page is open there, not in a tab on this computer/, `trif ${c.args.join(' ')}`);
    assert.match(c.stdout + c.stderr, /trif phone page/);
  }
  // The extension: asked nothing, shown no step of the run, and nothing of the phone's page.
  const since = ext.messages.slice(mark);
  assert.deepEqual(since.filter((m) => m.type === 'request').map((m) => m.cmd), [], 'nothing of the run\'s reached the extension');
  assert.deepEqual(since.filter((m) => m.type === 'agentEvent'), [], 'the phone\'s chat is not the panel\'s');
  for (const m of since) for (const s of SECRETS) assert.equal(JSON.stringify(m).includes(s), false, `${s} is in a ${m.type} message to the extension`);

  // The folder limit: the mods folder has the twin's two new files, and nothing else changed.
  const after = tree();
  assert.deepEqual(Object.keys(after).filter((k) => !(k in before)).sort(), [path.join('phone~m.x.com', 'part.js'), path.join('phone~x.com', 'bottom-bar.js')]);
  for (const k of Object.keys(before)) assert.equal(after[k], before[k], `${k} is as it was`);

  // Kept for the phone until it says it has it; never the page copy or a screenshot, there or anywhere (the
  // stand-in agent's own notes of what it was given aside).
  const keptFile = (id) => path.join(priv, 'phone-link', 'kept', idA, `${id}.json`);
  await waitFor(() => fs.existsSync(keptFile(runId)), { message: 'the kept run' });
  const noSecrets = () => {
    for (const dir of [home, priv, extra]) {
      for (const [file, text] of everyFile(dir)) {
        if (file.startsWith(bin + path.sep)) continue;
        for (const s of SECRETS) assert.equal(text.includes(s), false, `${s} is in ${file}`);
      }
    }
  };
  noSecrets();
  assert.deepEqual((await A.request(HELLO)).pending.map((p) => [p.runId, p.chat, p.done, p.last]), [[runId, 'chat-1', true, events.length]]);
  assert.equal((await A.request({ t: 'run.ack', runId })).t, 'ok');
  assert.deepEqual((await A.request(HELLO)).pending, []);
  assert.equal(fs.existsSync(keptFile(runId)), false);

  // ---- A second run, on another site; the phone goes away in the middle of it (the app is suspended).
  const ran2 = phoneCalls().length;
  const started2 = await A.request({ t: 'run.start', url: 'https://example.org/', page: PAGE, chat: 'chat-2', prompt: 'PAUSE:two WRITE PHONE[try bottom-bar]' });
  assert.equal(started2.t, 'run.started', JSON.stringify(started2));
  const run2 = started2.runId;
  const seen = await upTo(A, run2, (e) => /Working/.test(JSON.stringify(e)));
  const last = seen[seen.length - 1].n;
  await A.close();
  go('two');
  // The agent's try: no phone to ask, said in words, not a hang. The computer finishes and keeps the run.
  const [away] = await printed(ran2, 1);
  assert.notEqual(away.status, 0);
  assert.match(away.stdout + away.stderr, /the phone isn't connected right now/);
  await waitFor(() => { try { return JSON.parse(fs.readFileSync(keptFile(run2), 'utf8')).done; } catch { return false; } }, { timeout: 30000, message: 'the run to end and be kept with no phone there' });

  // The phone again, with the keys it has: told what waits, then the steps it missed and the result.
  A = await connect(port, computerKey, keysA);
  assert.deepEqual(A.hello.pending.map((p) => [p.runId, p.chat, p.done]), [[run2, 'chat-2', true]]);
  const resumed = await A.request({ t: 'run.resume', runId: run2, after: last });
  assert.deepEqual([resumed.t, resumed.first, resumed.last, resumed.done], ['ok', 1, A.hello.pending[0].last, true]);
  const missed = await upTo(A, run2);
  assert.deepEqual(seen.concat(missed).map((m) => m.n), Array.from({ length: resumed.last }, (_, i) => i + 1), 'every step once, in order, across the drop');
  assert.equal(missed[missed.length - 1].event.ok, true, JSON.stringify(missed));
  const result2 = await A.next((m) => m.t === 'run.result' && m.runId === run2);
  assert.deepEqual(result2.mods.map((m) => m.id).sort(), ['phone~example.org/bottom-bar', 'phone~m.example.org/part']);
  const after2 = tree();
  assert.deepEqual(Object.keys(after2).filter((k) => !(k in after)).sort(), [path.join('phone~example.org', 'bottom-bar.js'), path.join('phone~m.example.org', 'part.js')]);
  for (const k of Object.keys(after)) assert.equal(after2[k], after[k], `${k} is as it was`);
  assert.deepEqual(ext.messages.slice(mark).filter((m) => m.type === 'request' || m.type === 'agentEvent'), []);
  noSecrets();

  // ---- A second phone, then the panel removes the first: closed, its kept run deleted, not one byte for it
  // from then on. The second phone goes on.
  const window2 = await panel('phone.pair.start');
  const keysB = generateKeyPair();
  const B = await connect(window2.port, computerKey, keysB, { name: 'Phone B', pair: qrOf(window2.qr).secret });
  assert.deepEqual(B.hello.pending, [], 'a phone is told of its own runs alone');
  assert.equal((await B.request({ t: 'run.resume', runId: run2, after: 0 })).t, 'error');
  assert.equal(fs.existsSync(keptFile(run2)), true);
  const removed = await panel('phone.remove', { id: idA });
  assert.deepEqual(removed.removed, { id: idA, name: 'Tim\'s iPhone' });
  await A.closed;
  await waitFor(() => !fs.existsSync(path.dirname(keptFile(run2))), { message: 'what was kept for the phone to be deleted' });
  await assert.rejects(PhoneClient.connect({ port, computerKey, keys: keysA }), (e) => e.code === 'closed' && e.bytes === 0);
  await assert.rejects(PhoneClient.connect({ port, computerKey, keys: keysA, pair: secret }), (e) => e.code === 'closed' && e.bytes === 0);
  assert.equal((await B.request({ t: 'ping' })).t, 'pong');
  // (the mods it asked for are the user's files: they stay)
  assert.deepEqual(tree(), after2);

  // ---- Off, and the browser closes: nothing listens, nothing is announced, nothing is left running.
  const off = await panel('phone.off');
  assert.deepEqual([off.on, off.listening], [false, false]);
  await B.closed;
  assert.equal(await listening(port), false);
  await ext.close();
  for (const c of standIn.calls()) await waitFor(() => gone(c.pid), { message: 'the announcement to end' });
  for (const n of fs.readdirSync(path.join(bin, 'calls'))) assert.equal(gone(Number(n.split('-')[1].split('.')[0])), true, 'no agent is left behind');
});

'use strict';
// Messages sent while the agent works (the side panel's queue and Send now): the queue's rules (extension/lib.js),
// and the helper writing a message into a live Claude Code run (helper/lib/runs.js inject, agents/claude.js
// liveInput) with a fake `claude` that reads its messages as stream-json, as the real one does. The
// background's side (queue, send on done, Send now) is in extension.test.js. Never the real agent.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { FakeExtension, tempDir, sleep, privDir } = require('./fake-extension');
const claude = require('../helper/lib/agents/claude');
const codex = require('../helper/lib/agents/codex');

const cleanups = [];
test.after(async () => {
  for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* ignore */ } }
});

// ------------------------------------------------------------------ the queue's rules (lib.js)

test('queue: joined in order as one message, with the last one\'s settings; only those asked for', async () => {
  const { queuedMessage, normalizeQueue, QUEUE_MAX } = await import('../extension/lib.js');
  const q = [
    { id: 'a', text: 'hide the banner', time: 1, opts: { agent: 'claude', model: 'opus' } },
    { id: 'b', text: '  and the footer\n[attached: files/x.png] ', time: 2, opts: { agent: 'claude', model: 'haiku', tabId: 4 } },
    { id: '', text: 'no id' }, { id: 'c', text: '   ' }, null, 'junk',
  ];
  assert.deepEqual(normalizeQueue(q).map((x) => x.id), ['a', 'b']);
  const m = queuedMessage(q);
  assert.equal(m.text, 'hide the banner\n\nand the footer\n[attached: files/x.png]');
  assert.deepEqual(m.ids, ['a', 'b']);
  assert.deepEqual(m.opts, { agent: 'claude', model: 'haiku', tabId: 4 });
  assert.deepEqual(queuedMessage(q, ['a']).ids, ['a']);
  assert.equal(queuedMessage([]), null);
  assert.equal(queuedMessage(q, ['zzz']), null);
  assert.equal(normalizeQueue(Array.from({ length: 30 }, (_, i) => ({ id: `q${i}`, text: 'x' }))).length, QUEUE_MAX);
});

test('queue after a run: done sends them all; stopped or failed keeps them (but those sent now); not taken go again first', async () => {
  const { queueAfterRun } = await import('../extension/lib.js');
  const q = [{ id: 'a', text: 'one' }, { id: 'b', text: 'two', now: true }, { id: 'c', text: 'three' }];
  // Done: every one goes, marked going.
  let r = queueAfterRun(q, { finished: true });
  assert.deepEqual(r.send, ['a', 'b', 'c']);
  assert.ok(r.queue.every((x) => x.now));
  // Stopped or failed: only the one sent now goes; the others wait, unmarked.
  r = queueAfterRun(q, { finished: false });
  assert.deepEqual(r.send, ['b']);
  assert.deepEqual(r.queue.map((x) => [x.id, !!x.now]), [['a', false], ['b', true], ['c', false]]);
  r = queueAfterRun([{ id: 'a', text: 'one' }], { finished: false });
  assert.equal(r.send, null, 'nothing goes by itself');
  assert.deepEqual(r.queue.map((x) => x.id), ['a']);
  // Written into the run but never taken (stopped first): waiting again, first, and going now.
  r = queueAfterRun([{ id: 'a', text: 'one' }], { finished: false, back: [{ id: 'p', text: 'pushed' }] });
  assert.deepEqual(r.queue.map((x) => x.id), ['p', 'a']);
  assert.deepEqual(r.send, ['p']);
  assert.deepEqual(queueAfterRun(undefined, {}), { queue: [], send: null });
});

// ------------------------------------------------------------------ the adapters

test('claude adapter: a live run reads its messages as stream-json (stdin kept open), replayed when taken; others not live', () => {
  const limits = { workspace: '/h', home: '/Users/u', readable: ['/h'], privateDir: '/p', box: '/c/boxes/r1' };
  const plain = claude.command({ bin: '/x/claude', prompt: 'hi', agentDir: '/c/r1.agent', ...limits });
  assert.equal(plain.stdin, 'hi');
  assert.ok(!plain.keepStdin && !plain.args.includes('--input-format'));
  const live = claude.command({ bin: '/x/claude', prompt: 'hi there, my secret plan', agentDir: '/c/r1.agent', live: true, ...limits });
  assert.equal(live.keepStdin, true);
  assert.equal(live.args[live.args.indexOf('--input-format') + 1], 'stream-json');
  assert.ok(live.args.includes('--replay-user-messages'));
  assert.deepEqual(JSON.parse(live.stdin), { type: 'user', message: { role: 'user', content: 'hi there, my secret plan' } });
  assert.ok(live.stdin.endsWith('\n'));
  assert.ok(!live.args.some((a) => /secret plan/.test(a)), 'the message never in argv');
  assert.equal(claude.liveInput, true);
  assert.ok(!codex.liveInput, 'Codex takes no message while it works: Send now stops and sends again');

  // Replayed messages: the run's own first, then `taken` for each one written meanwhile.
  const out = [];
  const state = {};
  const user = (content, extra = {}) => JSON.stringify({ type: 'user', message: { role: 'user', content }, isReplay: true, ...extra });
  claude.parse(user('hi there'), (e) => out.push(e), state);
  claude.parse(user('also the footer'), (e) => out.push(e), state);
  claude.parse(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }), (e) => out.push(e), state);
  assert.deepEqual(out, [{ kind: 'taken', text: 'also the footer' }]);
  assert.equal(state.prompted, true);
});

// ------------------------------------------------------------------ the helper (runs.js inject), a fake live claude

// A fake Claude Code reading stream-json from stdin as the real one does (checked with 2.1.319: a message written
// while it works comes back, isReplay, at its next step, and it goes on with it; one written after the turn's
// result starts another turn; it exits once stdin closes and nothing is left). Its steps are STEP ms apart (SLOW in
// the message: 2 s); it works for 3 steps, then its result. Without --input-format it reads plain text, as before.
const FAKE_LIVE_CLAUDE = `#!${process.execPath}
'use strict';
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('9.9.9 (Claude Code)'); process.exit(0); }
if (argv[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })); process.exit(0); }
const live = argv[argv.indexOf('--input-format') + 1] === 'stream-json' && argv.indexOf('--input-format') !== -1;
const replay = argv.includes('--replay-user-messages');
const say = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const log = path.join(__dirname, 'stdin.log');
const session = 'sess-live-1';
if (!live) {
  const text = fs.readFileSync(0, 'utf8');
  fs.appendFileSync(log, JSON.stringify({ live: false, text }) + '\\n');
  say({ type: 'system', subtype: 'init', session_id: session });
  say({ type: 'assistant', message: { content: [{ type: 'text', text: 'Plain: ' + text }] } });
  say({ type: 'result', subtype: 'success', is_error: false, result: 'plain', session_id: session, total_cost_usd: 0.001 });
  process.exit(0);
}
let buf = '', closed = false, busy = false, started = false;
const waiting = [];
const take = (m) => {
  const text = m.message.content;
  fs.appendFileSync(log, JSON.stringify({ live: true, text }) + '\\n');
  if (replay) say({ type: 'user', message: { role: 'user', content: text }, session_id: session, isReplay: true });
  return text;
};
const turn = (first) => {
  busy = true;
  const step = process.env.FAKE_STEP_MS || (first.message.content.includes('SLOW') ? 2000 : 150);
  say({ type: 'assistant', message: { content: [{ type: 'text', text: 'Working on: ' + take(first) }] } });
  let n = 0;
  const next = () => {
    for (const m of waiting.splice(0)) say({ type: 'assistant', message: { content: [{ type: 'text', text: 'Also: ' + take(m) }] } });
    if (++n < 3) return setTimeout(next, step);
    say({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', session_id: session, total_cost_usd: 0.002 });
    busy = false;
    setTimeout(after, 50);
  };
  setTimeout(next, step);
};
const after = () => {
  if (busy) return;
  if (waiting.length) return turn(waiting.shift());
  if (closed) process.exit(0);
};
say({ type: 'system', subtype: 'init', session_id: session });
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  let nl;
  while ((nl = buf.indexOf('\\n')) !== -1) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (!started) { started = true; turn(m); } else waiting.push(m);
  }
});
process.stdin.on('end', () => { closed = true; fs.appendFileSync(log, JSON.stringify({ closed: true }) + '\\n'); after(); });
`;

function makeHome() {
  const home = tempDir();
  const bin = path.join(home, 'fakebin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(home, 'sites'));
  fs.writeFileSync(path.join(bin, 'claude'), FAKE_LIVE_CLAUDE, { mode: 0o755 });
  fs.mkdirSync(privDir(home), { recursive: true });
  fs.writeFileSync(path.join(privDir(home), 'config.json'), JSON.stringify({ env: { PATH: bin } }));
  return { home, bin };
}
const stdinLog = (bin) => {
  try { return fs.readFileSync(path.join(bin, 'stdin.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
};

function startHost(home) {
  const ext = new FakeExtension({ home, env: { TRIF_AGENT_KILL_GRACE_MS: '400' } });
  cleanups.push(() => ext.close());
  return ext;
}
let reqN = 0;
async function extRequest(ext, cmd, args = {}) {
  const id = `e${++reqN}`;
  ext.send({ type: 'request', id, cmd, args });
  return ext.next((m) => m.type === 'response' && m.id === id, { timeout: 10000 });
}
const eventsOf = (ext, runId) => ext.messages.filter((m) => m.type === 'agentEvent' && m.runId === runId).map((m) => m.event);
const waitEvent = (ext, runId, kind, timeout = 10000) => ext.next((m) => m.type === 'agentEvent' && m.runId === runId && m.event.kind === kind, { timeout }).then((m) => m.event);
const START = { site: 'example.com', url: 'https://example.com/page', tabId: 12, agent: 'claude' };

test('agent.inject: a message written into a live run is taken at its next step; the run goes on and ends once', async () => {
  const { home, bin } = makeHome();
  const ext = startHost(home);
  const r = await extRequest(ext, 'agent.start', { ...START, prompt: 'hide the banner', live: true });
  assert.equal(r.ok, true, r.error);
  const { runId } = r.result;
  await waitEvent(ext, runId, 'text');
  const inj = await extRequest(ext, 'agent.inject', { runId, text: 'and the footer too', id: 'q1' });
  assert.deepEqual(inj.result, { injected: true });
  assert.deepEqual(await waitEvent(ext, runId, 'taken'), { kind: 'taken', id: 'q1' });
  const done = await waitEvent(ext, runId, 'done');
  assert.equal(done.ok, true);
  assert.ok(!done.notTaken, 'it took it');
  await sleep(100);
  const texts = eventsOf(ext, runId).filter((e) => e.kind === 'text').map((e) => e.text);
  assert.deepEqual(texts, ['Working on: hide the banner', 'Also: and the footer too']);
  assert.equal(eventsOf(ext, runId).filter((e) => e.kind === 'done').length, 1);
  // What the agent read: both messages, then its stdin closed (after its result), so it exited.
  assert.deepEqual(stdinLog(bin), [{ live: true, text: 'hide the banner' }, { live: true, text: 'and the footer too' }, { closed: true }]);
  // Too late now: the run is over.
  assert.deepEqual((await extRequest(ext, 'agent.inject', { runId, text: 'late', id: 'q2' })).result, { injected: false, why: 'not running' });
  // The message isn't in the run's raw log as an inject of its own (only that one came, by id).
  assert.match(fs.readFileSync(path.join(privDir(home), 'runs', `${runId}.jsonl`), 'utf8'), /"webmods":"inject","id":"q1"/);
});

test('agent.inject: stopped before it took the message, `done` names it (notTaken) so the panel sends it again', async () => {
  const { home } = makeHome();
  const ext = startHost(home);
  const r = await extRequest(ext, 'agent.start', { ...START, prompt: 'SLOW hide the banner', live: true });
  const { runId } = r.result;
  await waitEvent(ext, runId, 'text');
  assert.deepEqual((await extRequest(ext, 'agent.inject', { runId, text: 'stop that, do this', id: 'q9' })).result, { injected: true });
  await extRequest(ext, 'agent.stop', { runId });
  const done = await waitEvent(ext, runId, 'done');
  assert.equal(done.ok, false);
  assert.equal(done.stopped, true);
  assert.deepEqual(done.notTaken, ['q9']);
});

test('agent.inject: a run that isn\'t live (the terminal\'s, or another agent) says so; only the extension may ask', async () => {
  const { home, bin } = makeHome();
  const ext = startHost(home);
  const r = await extRequest(ext, 'agent.start', { ...START, prompt: 'hide the banner' });
  const { runId } = r.result;
  const inj = await extRequest(ext, 'agent.inject', { runId, text: 'more', id: 'q1' });
  assert.equal(inj.result.injected, false);
  await waitEvent(ext, runId, 'done');
  assert.deepEqual(stdinLog(bin), [{ live: false, text: 'hide the banner' }], 'plain stdin, as before');
  // Bad requests
  assert.equal((await extRequest(ext, 'agent.inject', { runId, text: '  ', id: 'q1' })).ok, false);
  assert.equal((await extRequest(ext, 'agent.inject', { runId, text: 'x', id: '../bad id' })).ok, false);
  // Not from the socket (the terminal, or a run's `trif`): the side panel's alone.
  await ext.waitForSocket();
  const answer = await new Promise((resolve, reject) => {
    const s = net.connect(ext.sock);
    let buf = '';
    s.setEncoding('utf8');
    s.on('connect', () => s.write(JSON.stringify({ id: 1, cmd: 'agent.inject', args: { runId, text: 'x', id: 'q1' } }) + '\n'));
    s.on('data', (d) => { buf += d; if (buf.includes('\n')) { s.destroy(); resolve(JSON.parse(buf.slice(0, buf.indexOf('\n')))); } });
    s.on('error', reject);
  });
  assert.equal(answer.ok, false);
  assert.match(answer.error, /side panel/);
});

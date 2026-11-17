'use strict';
// PhoneLink.swift (the iPhone's side of the phone link, docs/PHONE-LINK.md on branch phone-link) built for the
// Mac with swiftc and run against a stand-in computer made of the helper's own noise.js and frames.js: the
// published vector, a handshake with a pairing secret, messages of several pieces both ways, and the ends
// (refused, unreachable, broken, dropped, closed). macOS only. The helper's files are on branch phone-link: from
// TRIF_PHONE_LINK_LIB, else ~/WebMods-worktrees/phone-link/helper/lib/phonelink, else this checkout's own
// helper/lib/phonelink (once merged); without them only the self-test runs.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { execFileSync, spawn } = require('child_process');

const HERE = __dirname;
const SWIFT = [path.join(HERE, '..', 'browser-probe', 'TrifProbe', 'PhoneLink.swift'), path.join(HERE, '..', 'browser-probe', 'TrifProbe', 'PhoneLinkPair.swift'),
  path.join(HERE, '..', 'browser-probe', 'TrifProbe', 'PhoneLinkRemote.swift'),
  path.join(HERE, 'phonelink-check', 'main.swift')];
const mac = process.platform === 'darwin';
const lib = [process.env.TRIF_PHONE_LINK_LIB, path.join(os.homedir(), 'WebMods-worktrees', 'phone-link', 'helper', 'lib', 'phonelink'),
  path.join(HERE, '..', '..', 'helper', 'lib', 'phonelink')].find((d) => d && fs.existsSync(path.join(d, 'noise.js')) && fs.existsSync(path.join(d, 'frames.js')));

let bin = null;
function build() {
  if (bin) return bin;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-phonelink-check-'));
  bin = path.join(dir, 'check');
  execFileSync('xcrun', ['swiftc', '-O', ...SWIFT, '-o', bin], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 170000 });
  return bin;
}

/** Runs the check: {lines, code}; killed after `ms`. */
function run(args, ms = 20000, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(build(), args, { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, ...env } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    const t = setTimeout(() => child.kill('SIGKILL'), ms);
    child.on('exit', (code) => { clearTimeout(t); resolve({ lines: out.trim().split('\n'), code }); });
  });
}

test('PhoneLink.swift: the published Noise IK vector and the frames vector, in CryptoKit', { skip: !mac && 'macOS only', timeout: 180000 }, async () => {
  const { lines, code } = await run(['selftest']);
  assert.equal(code, 0);
  assert.deepEqual(lines, ['ok']);
});

const noLib = !mac ? 'macOS only' : !lib && 'the helper\'s phonelink folder (branch phone-link) isn\'t here';

/** A stand-in computer on 127.0.0.1: `onConnection({socket, read, write, handshake})` per connection. */
async function computer(onConnection) {
  const { Handshake, generateKeyPair } = require(path.join(lib, 'noise.js'));
  const frames = require(path.join(lib, 'frames.js'));
  const keys = generateKeyPair();
  const server = net.createServer((socket) => {
    const reader = new frames.PacketReader();
    const waiting = [];
    let wake = null;
    socket.on('data', (chunk) => { waiting.push(...reader.push(chunk)); if (wake) { wake(); wake = null; } });
    socket.on('error', () => {});
    const read = async () => { while (!waiting.length) await new Promise((r) => { wake = r; }); return waiting.shift(); };
    const handshake = new Handshake({ initiator: false, s: keys });
    onConnection({ socket, read, handshake, frames });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { keys, port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}

const phoneKeys = () => require(path.join(lib, 'noise.js')).generateKeyPair();

test('PhoneLink.swift against the helper\'s noise.js and frames.js: pairing payload, messages of several pieces both ways, closed', { skip: noLib, timeout: 180000 }, async () => {
  const phone = phoneKeys();
  const got = [];
  const c = await computer(async ({ socket, read, handshake, frames }) => {
    const first = JSON.parse(handshake.readMessage(await read()).toString());
    got.push({ first, rs: handshake.rs.toString('hex') });
    socket.write(frames.packet(handshake.writeMessage(Buffer.from(JSON.stringify({ v: 1, name: 'Stand-in Mac', paired: true })))));
    const { send, receive } = handshake.split();
    const asm = new frames.Assembler(receive);
    const next = async () => { for (;;) { const o = asm.push(await read()); if (o) return o; } };
    got.push(await next(), await next());
    for (const p of frames.seal(send, { t: 'run.event', blob: 'z'.repeat(200000) })) socket.write(p);
    for (const p of frames.seal(send, { t: 'bye' })) socket.write(p);
  });
  const { lines } = await run(['connect', String(c.port), c.keys.publicKey.toString('hex'), phone.privateKey.toString('hex'), 'c2VjcmV0LXNlY3JldA']);
  await c.close();
  assert.deepEqual(lines, ['open {"name":"Stand-in Mac","paired":true,"v":1}', 'msg run.event 200000', 'msg bye 0', 'end closed']);
  assert.deepEqual(got[0], { first: { v: 1, name: 'Check phone', pair: 'c2VjcmV0LXNlY3JldA' }, rs: phone.publicKey.toString('hex') });
  assert.deepEqual(got[1], { t: 'hello', id: 1, app: 'check' });
  assert.equal(got[2].t, 'big');
  assert.equal(got[2].blob, 'y'.repeat(300000) + 'é', 'the 300 KB message (6 pieces) arrived whole');
});

test('PhoneLink.swift: the ends a phone shows as states (refused, unreachable, broken, dropped)', { skip: noLib, timeout: 180000 }, async () => {
  const phone = phoneKeys();
  const ends = {};
  // refused: the computer reads the first message and closes with nothing sent (an unpaired or removed phone)
  let c = await computer(async ({ socket, read }) => { await read(); socket.destroy(); });
  ends.refused = (await run(['connect', String(c.port), c.keys.publicKey.toString('hex'), phone.privateKey.toString('hex')])).lines;
  await c.close();
  // unreachable: nobody on the port (a stale record of a helper that was killed)
  ends.unreachable = (await run(['connect', String(c.port), c.keys.publicKey.toString('hex'), phone.privateKey.toString('hex')])).lines;
  // broken: an answer that doesn't decrypt (not the computer the QR named)
  c = await computer(async ({ socket, read, frames }) => { await read(); socket.write(frames.packet(require('crypto').randomBytes(48))); });
  ends.broken = (await run(['connect', String(c.port), c.keys.publicKey.toString('hex'), phone.privateKey.toString('hex')])).lines;
  await c.close();
  // dropped: open, then the connection goes
  c = await computer(async ({ socket, read, handshake, frames }) => {
    handshake.readMessage(await read());
    socket.write(frames.packet(handshake.writeMessage(Buffer.from('{"v":1}'))));
    await read();
    socket.destroy();
  });
  ends.dropped = (await run(['connect', String(c.port), c.keys.publicKey.toString('hex'), phone.privateKey.toString('hex')])).lines;
  await c.close();
  assert.deepEqual(ends.refused, ['end refused']);
  assert.equal(ends.unreachable.length, 1);
  assert.match(ends.unreachable[0], /^end unreachable\(/);
  assert.equal(ends.broken.length, 1);
  assert.match(ends.broken[0], /^end broken\(/);
  assert.equal(ends.dropped[0], 'open {"v":1}');
  assert.match(ends.dropped[1], /^end dropped\(/);
});

test('PhoneLinkPair.swift: PairCode reads the helper\'s code and nothing else; nobody at the address is not found', { skip: !mac && 'macOS only', timeout: 180000 }, async () => {
  const k = Buffer.alloc(32, 7).toString('base64url');
  const sec = Buffer.alloc(16, 9).toString('base64url');
  const id = require('crypto').createHash('sha256').update(Buffer.alloc(32, 7)).digest().subarray(0, 8).toString('hex');
  const good = `trif://pair?v=1&k=${k}&s=${sec}&n=Tim%E2%80%99s%20MacBook%20Pro%E2%80%A6`;
  const { lines } = await run(['parse', good, `TRIF://PAIR?v=1&k=${k}&s=${sec}&n=`, `trif://pair?v=2&k=${k}&s=${sec}&n=x`,
    `trif://pair?v=1&k=${k.slice(1)}&s=${sec}&n=x`, `trif://pair?v=1&k=${k}&s=${sec}=&n=x`, `trif://pair?v=1&k=${k}&k=${k}&s=${sec}&n=x`,
    `trif://add?v=1&k=${k}&s=${sec}&n=x`, `https://pair?v=1&k=${k}&s=${sec}&n=x`, `trif://pair?v=1&k=${k}&s=${sec}&n=a%0Ab%E2%80%8Ec`]);
  assert.deepEqual(lines, [`code ${id} ${sec} Tim’s MacBook Pro…`, `code ${id} ${sec} your computer`, 'none', 'none', 'none', 'none', 'none', 'none',
    `code ${id} ${sec} abc`]);
  // nobody at the address (a stale record, or the computer gone): not found, nothing kept
  const free = net.createServer();
  await new Promise((r) => free.listen(0, '127.0.0.1', r));
  const port = free.address().port;
  await new Promise((r) => free.close(r));
  const gone = await run(['pair', String(port), good]);
  assert.deepEqual(gone.lines.slice(0, 4).map((l) => l.replace(/\(\w+\.PhoneLinkPairer\.Failure\./, '(')),
    ['step finding', 'step connecting', 'step failed(notFound)', 'kept none']);
});

const helperLib = lib && ['store.js', 'server.js'].every((f) => fs.existsSync(path.join(lib, f))) && fs.existsSync(path.join(lib, '..', '..', '..', 'tests', 'fake-keychain.js'));
const noHelper = noLib || (!helperLib && 'the helper\'s store.js and server.js (branch phone-link) aren\'t here');

test('PhoneLinkPair.swift against the real helper (server.js, store.js, a temp HOME): pairs, the computer lists the phone; a used, a cancelled and a wrong code are refused; a removed phone pairs again', { skip: noHelper, timeout: 180000 }, async () => {
  const { makeFakeKeychain } = require(path.join(lib, '..', '..', '..', 'tests', 'fake-keychain.js'));
  const { Store } = require(path.join(lib, 'store.js'));
  const { Server } = require(path.join(lib, 'server.js'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-phonelink-pair-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  const chain = makeFakeKeychain(path.join(root, 'keychain'));
  const store = new Store(home, { env: { ...chain.env }, name: 'Stand-in Mac' });
  const server = new Server(store, { version: '9.9.9', host: '127.0.0.1', port: 0, log: () => {} });
  try {
    await store.setOn(true);
    await server.start();
    const computerId = require('crypto').createHash('sha256').update((await store.keys()).publicKey).digest().subarray(0, 8).toString('hex');
    const first = store.pairStart().qr;
    let port = await server.sync();
    // (a code whose window was cancelled; a code with a wrong secret, for an open window: each refused, and the
    // wrong one doesn't close the window, the right one pairs after it)
    const cancelled = store.pairStart().qr; // (replaces `first`'s secret: `first` is now refused too)
    store.pairStop();
    const right = store.pairStart().qr;
    port = await server.sync();
    const wrong = right.replace(/&s=[^&]+/, '&s=' + Buffer.alloc(16, 1).toString('base64url'));
    const keys = phoneKeys();
    const env = { CHECK_PHONE_KEY: keys.privateKey.toString('hex') };
    const { lines } = await run(['pair', String(port), first, String(port), cancelled, String(port), wrong, String(port), right, String(port), right], 60000, env);
    const phone = lines.pop();
    assert.equal(phone, 'phone ' + keys.publicKey.toString('hex'), 'the phone\'s key from the vault');
    const plain = (ls) => ls.map((l) => l.replace(/\(\w+\.PhoneLinkPairer\.Failure\./, '('));
    const refused = ['step finding', 'step connecting', 'step failed(refused)', 'kept none'];
    const paired = ['step finding', 'step connecting', 'step paired("Stand-in Mac")', `kept Stand-in Mac ${computerId}`];
    // (the last: the same code again, its window closed, but this phone is paired: let in as the phone it is)
    assert.deepEqual(plain(lines), [...refused, ...refused, ...refused, ...paired, ...paired]);
    const listed = store.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].name, 'Check phone');
    assert.equal(listed[0].id, require('crypto').createHash('sha256').update(keys.publicKey).digest().subarray(0, 8).toString('hex'));
    // removed on the computer: the old code is refused; a new code pairs the same phone key again
    store.remove(listed[0].id);
    const again = store.pairStart().qr;
    port = await server.sync();
    const second = await run(['pair', String(port), right, String(port), again], 60000, env);
    assert.deepEqual(plain(second.lines.slice(0, 8)), [...refused, ...paired]);
    assert.equal(second.lines[8], phone, 'the same phone key');
    assert.equal(store.list().length, 1);
  } finally {
    store.pairStop();
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const computerFixture = lib && path.join(lib, '..', '..', '..', 'tests', 'phone-link-computer.js');
const noComputer = noLib || (!(computerFixture && fs.existsSync(computerFixture)) && 'the stand-in computer (branch phone-link\'s tests/phone-link-computer.js) isn\'t here');

/** A child's stdout as lines: `next(pred, ms)` → the first line from now on (or already waiting) that matches. */
function lineReader(child, label) {
  const lines = [];
  let buf = '';
  let wake = null;
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 1); } if (wake) wake(); });
  let seen = 0;
  const all = [];
  async function next(pred, ms = 20000) {
    const end = Date.now() + ms;
    for (;;) {
      while (seen < lines.length) { const l = lines[seen++]; all.push(l); if (pred(l)) return l; }
      const left = end - Date.now();
      if (left <= 0) throw new Error(`${label}: no line matching ${pred} in ${ms} ms; had:\n${all.join('\n')}`);
      await new Promise((r) => { wake = r; setTimeout(r, Math.min(left, 200)); });
    }
  }
  return { next, all };
}

test('PhoneLinkRemote.swift (My computer) against the real helper (Store, Server, Runs, Remote, the stand-in agent, a temp HOME): a run with its steps, try on the phone, page and screenshot, the result; dropped and resumed; kept while the app was closed and picked up; removed', { skip: noComputer, timeout: 180000 }, async () => {
  build();
  const comp = spawn(process.execPath, [computerFixture, '--seconds', '150'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const C = lineReader(comp, 'computer');
  let phone = null;
  try {
    const { port, qr } = JSON.parse(await C.next((l) => l.startsWith('{"port"')));
    phone = spawn(bin, ['remote', String(port), qr], { stdio: ['pipe', 'pipe', 'inherit'] });
    const P = lineReader(phone, 'phone');
    const say = (l) => phone.stdin.write(l + '\n');
    assert.equal(await P.next((l) => l.startsWith('paired') || l.includes('failed')), 'paired Stand-in Mac');
    assert.equal(await P.next((l) => l.startsWith('hello') || l.includes('failed')), 'hello Stand-in Mac agent Stand-in agent pending 0');

    // 1. A run: its steps numbered and in order, the three tools asked of the phone and answered, the twin's mod.
    say('run x.com WRITE PHONE[try bottom-bar] PHONE[page nav --limit 3] PHONE[screenshot]');
    const first = P.all.length;
    assert.equal(await P.next((l) => l.startsWith('started') || l.startsWith('error')), 'started');
    const result = await P.next((l) => l.startsWith('result'));
    const got = P.all.slice(first);
    const tools = got.filter((l) => l.startsWith('tool '));
    assert.deepEqual(tools, [
      'tool try_mod {"code":"\\/\\/ ==WebMod==","id":"phone~x.com\\/bottom-bar"}',
      'tool read_page {"limit":3,"selector":"nav"}',
      'tool screenshot {}',
    ]);
    const events = got.filter((l) => l.startsWith('event '));
    assert.deepEqual(events.map((l) => Number(l.split(' ')[1])), events.map((_, i) => i + 1), 'numbered from 1, none twice');
    assert.ok(events.some((l) => / text Done\.$/.test(l)), events.join('\n'));
    assert.match(events[events.length - 1], /^event \d+ done ok true$/);
    assert.equal(result, 'result phone~m.x.com/part,phone~x.com/bottom-bar removed 0', 'the twin\'s mods only');

    // 2. The link drops while a run waits; the computer finishes; the phone comes back and gets the rest, once.
    say('run y.com PAUSE:a WRITE PHONE[screenshot]');
    await P.next((l) => l.startsWith('started'));
    const one = await P.next((l) => / text Working$/.test(l));
    say('drop');
    assert.equal(await P.next((l) => l.startsWith('state')), 'state away');
    const mark = P.all.length;
    comp.stdin.write('go a\n');
    // (until the computer has the run's end: then nothing of it can reach the phone live)
    for (let i = 0; i < 100; i++) {
      comp.stdin.write('kept\n');
      const k = JSON.parse(await C.next((l) => l.startsWith('{"kept"')));
      const mine = Object.values(k.kept).flat();
      if (mine.length && mine.every((r) => r.done)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.deepEqual(P.all.slice(mark).filter((l) => !l.startsWith('state')), [], 'nothing while away');
    say('wake');
    const back = await P.next((l) => l.startsWith('result'));
    const after = P.all.slice(mark);
    assert.ok(!after.some((l) => l.startsWith('tool ')), 'the screenshot asked while away was never asked of the phone');
    const evs = after.filter((l) => l.startsWith('event '));
    const n1 = Number(one.split(' ')[1]);
    assert.deepEqual(evs.map((l) => Number(l.split(' ')[1])), evs.map((_, i) => n1 + 1 + i), 'resumed after the last event it had');
    assert.match(evs[evs.length - 1], /^event \d+ done ok true$/);
    assert.equal(back, 'result phone~m.y.com/part,phone~y.com/bottom-bar removed 0');
    // (acked: the computer keeps nothing)
    for (let i = 0; i < 50; i++) { comp.stdin.write('kept\n'); const k = JSON.parse(await C.next((l) => l.startsWith('{"kept"'))); if (!Object.values(k.kept).flat().length) break; assert.ok(i < 49, 'acked runs deleted'); await new Promise((r) => setTimeout(r, 100)); }

    // 2b. The app closed while a run waits (the link closed, nothing followed); the computer finishes and keeps it;
    // the app opened again is told of it in hello's pending and picks it up after the last step its chat shows
    // (kept across the close as across launches: none twice), to the result.
    say('run w.com PAUSE:b WRITE');
    await P.next((l) => l.startsWith('started'));
    const seen = Number((await P.next((l) => / text Working$/.test(l))).split(' ')[1]);
    say('close');
    comp.stdin.write('go b\n');
    for (let i = 0; i < 100; i++) {
      comp.stdin.write('kept\n');
      const k = JSON.parse(await C.next((l) => l.startsWith('{"kept"')));
      const mine = Object.values(k.kept).flat();
      if (mine.length && mine.every((r) => r.done)) break;
      assert.ok(i < 99, 'the run kept, done');
      await new Promise((r) => setTimeout(r, 100));
    }
    say('reopen');
    assert.equal(await P.next((l) => l.startsWith('hello') || l.includes('failed')), 'hello Stand-in Mac agent Stand-in agent pending 1');
    const mark2 = P.all.length;
    say('pickup');
    assert.equal(await P.next((l) => l.startsWith('pending')), 'pending w.com done true');
    const kept = await P.next((l) => l.startsWith('result'));
    const evs2 = P.all.slice(mark2).filter((l) => l.startsWith('event '));
    assert.ok(evs2.length > 1, 'the steps after the close');
    assert.deepEqual(evs2.map((l) => Number(l.split(' ')[1])), evs2.map((_, i) => seen + 1 + i), 'after the last step shown, none twice');
    assert.ok(!evs2.some((l) => / text Working$/.test(l)), 'Working not shown again');
    assert.match(evs2[evs2.length - 1], /^event \d+ done ok true$/);
    assert.equal(kept, 'result phone~m.w.com/part,phone~w.com/bottom-bar removed 0');
    for (let i = 0; i < 50; i++) { comp.stdin.write('kept\n'); const k = JSON.parse(await C.next((l) => l.startsWith('{"kept"'))); if (!Object.values(k.kept).flat().length) break; assert.ok(i < 49, 'the picked-up run acked'); await new Promise((r) => setTimeout(r, 100)); }

    // 3. Removed on the computer: the link closes; reconnecting is refused, and a new run says why. (A pairing
    // window is open there, so the listener stays up: with no phone paired and no window, nothing listens, and
    // the phone finds nothing: `lost away`, "not found".)
    say('run z.com SLEEP');
    await P.next((l) => / text Thinking$/.test(l));
    comp.stdin.write('pair\n');
    await C.next((l) => l.startsWith('{"qr"'));
    comp.stdin.write('remove\n');
    await C.next((l) => l.startsWith('{"removed"'));
    assert.equal(await P.next((l) => l.startsWith('state')), 'state away');
    say('wake');
    assert.equal(await P.next((l) => l.startsWith('lost')), 'lost removed');
    say('run z.com hello');
    assert.equal(await P.next((l) => l.startsWith('error')), 'error removed');
  } finally {
    if (phone) phone.kill('SIGKILL');
    comp.stdin.write('quit\n');
    await new Promise((r) => { const t = setTimeout(() => { comp.kill('SIGKILL'); r(); }, 5000); comp.on('exit', () => { clearTimeout(t); r(); }); });
  }
});

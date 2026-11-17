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
const SWIFT = [path.join(HERE, '..', 'browser-probe', 'TrifProbe', 'PhoneLink.swift'), path.join(HERE, 'phonelink-check', 'main.swift')];
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
function run(args, ms = 20000) {
  return new Promise((resolve) => {
    const child = spawn(build(), args, { stdio: ['ignore', 'pipe', 'inherit'] });
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

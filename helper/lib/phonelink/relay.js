'use strict';
// The phone link between helpers (docs/PHONE-LINK.md "Two browsers"). Only the helper that owns helper.sock owns
// the link (link.js): its listener, its announcer, its pairing window. Every other browser's panel reaches it
// through its own helper, which relays its `phone.*` commands to helper.sock, and the owner tells the other
// helpers when the link changes, so each panel shows the same thing whichever browser it is in.
//
//   phone.relay    {key, cmd, args}  to helper.sock: the owner runs `cmd` (one of link.js COMMANDS) as if its own
//                                    panel had asked, and answers what it would answer its panel (the QR's text
//                                    included, for pair.start: the asking helper passes it to its panel alone)
//   phone.relayed  {key, status}     from the owner to each helper-<pid>.sock: the link's status now (no secret)
//
// Both carry the relay key: 32 random bytes in the private folder (`phone-relay.key`, mode 600), made by the
// first helper that needs it. The private folder is where the link's own file is, and no agent run can read it
// (SECURITY.md), so a run's `trif`, or a page, can't pair a phone or turn the link on through the socket: the
// phone link stays the side panel's alone (host.js PANEL_COMMANDS), whichever browser's panel it is.

const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');

const KEY_FILE = 'phone-relay.key';
const KEY_RE = /^[0-9a-f]{64}$/;

/** The relay key (64 hex characters), made once in `privateDir`. Throws when it can't be read or made. */
function relayKey(privateDir) {
  const file = path.join(privateDir, KEY_FILE);
  const read = () => { const k = fs.readFileSync(file, 'utf8').trim(); return KEY_RE.test(k) ? k : null; };
  try { const k = read(); if (k) return k; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
  const fresh = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(file, fresh + '\n', { flag: 'wx', mode: 0o600 });
    return fresh;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  // (another helper made it just now; or the file is unreadable as a key: made again)
  const k = read();
  if (k) return k;
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, fresh + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
  return fresh;
}

/** Whether `given` is the relay key (in constant time). False when there is no key yet: nobody could know one. */
function keyMatches(privateDir, given) {
  if (typeof given !== 'string' || !KEY_RE.test(given)) return false;
  let key;
  try { key = fs.readFileSync(path.join(privateDir, KEY_FILE), 'utf8').trim(); } catch { return false; }
  if (!KEY_RE.test(key)) return false;
  return crypto.timingSafeEqual(Buffer.from(key), Buffer.from(given));
}

/**
 * One request to another helper's socket: resolves {ok, result, error, code}. Rejects with `e.code` 'unreachable'
 * when nobody answers there (no socket, refused, closed before answering) and 'timeout' after `timeoutMs`.
 */
function ask(sock, cmd, args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const id = `relay-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    let buf = '';
    let done = false;
    const s = net.connect(sock);
    const finish = (err, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      s.destroy();
      if (err) reject(err); else resolve(value);
    };
    const fail = (code, message) => { const e = new Error(message); e.code = code; return e; };
    const timer = setTimeout(() => finish(fail('timeout', `the other browser's helper didn't answer in ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
    s.setEncoding('utf8');
    s.on('connect', () => s.write(JSON.stringify({ id, cmd, args }) + '\n'));
    s.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > 1 << 20) return finish(fail('unreachable', 'the other helper\'s answer is too long'));
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (!msg || msg.id !== id) continue;
        return finish(null, { ok: !!msg.ok, result: msg.result, error: msg.error, code: msg.code, relay: !!msg.relay });
      }
    });
    s.on('error', (e) => finish(fail('unreachable', `no helper answers there (${e.code || e.message})`)));
    s.on('close', () => finish(fail('unreachable', 'the other helper closed the connection before answering')));
  });
}

module.exports = { relayKey, keyMatches, ask, KEY_FILE };

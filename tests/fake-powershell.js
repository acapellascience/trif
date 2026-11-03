'use strict';
// A stand-in for Windows PowerShell (helper/lib/win/powershell.js, through TRIF_KEYCHAIN_BIN or a `bin`
// option), so the Windows keyring (win/credman.js) and PATH step (win/userpath.js) can be tested on any
// system without touching Credential Manager or the registry. It's a .js file, which powershell.js runs
// with this Node (so it works on Windows too, where a .js can't be started directly).
//
// It decodes -EncodedCommand to tell the two scripts apart (credman's mentions TrifCred, userpath's
// TRIF_USER_PATH), reads the request line on stdin as they do, and keeps state next to itself:
// creds.json ({target: {user, hex}}) and userpath.txt (the user's Path value). Every call's argv (never its
// stdin) goes to argv.log, so tests can check a key never appears in a command line. A file named `fail`
// next to it makes every call fail with its contents on stderr.

const fs = require('fs');
const path = require('path');

const SCRIPT = `'use strict';
const fs = require('fs');
const path = require('path');
const here = __dirname;
const argv = process.argv.slice(2);
fs.appendFileSync(path.join(here, 'argv.log'), JSON.stringify(argv) + '\\n');
const fail = (() => { try { return fs.readFileSync(path.join(here, 'fail'), 'utf8'); } catch { return null; } })();
if (fail !== null) { process.stderr.write(fail + '\\n'); process.exit(1); }
const i = argv.indexOf('-EncodedCommand');
if (i < 0 || !argv.includes('-NoProfile') || !argv.includes('-NonInteractive')) { process.stderr.write('bad arguments\\n'); process.exit(64); }
const script = Buffer.from(argv[i + 1], 'base64').toString('utf16le');
const line = (() => { try { return fs.readFileSync(0, 'utf8').split('\\n')[0]; } catch { return ''; } })();
const req = JSON.parse(line);
if (script.includes('TrifCred')) {
  const f = path.join(here, 'creds.json');
  const creds = (() => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } })();
  const save = () => fs.writeFileSync(f, JSON.stringify(creds));
  if (req.op === 'get') { if (!(req.target in creds)) process.exit(44); process.stdout.write(creds[req.target].hex); process.exit(0); }
  if (req.op === 'has') process.exit(req.target in creds ? 0 : 44);
  if (req.op === 'set') { if (!/^([0-9a-f]{2})+$/.test(req.hex)) process.exit(1); creds[req.target] = { user: req.user, hex: req.hex }; save(); process.exit(0); }
  if (req.op === 'delete') { if (!(req.target in creds)) process.exit(44); delete creds[req.target]; save(); process.exit(0); }
  process.exit(2);
}
if (script.includes('TRIF_USER_PATH')) {
  const f = path.join(here, 'userpath.txt');
  const old = (() => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } })();
  const norm = (p) => p.replace(/[\\\\/]+$/, '').toLowerCase();
  if (old.split(';').some((e) => e && norm(e) === norm(req.dir))) { process.stdout.write('already'); process.exit(0); }
  if (req.check) { process.stdout.write('missing'); process.exit(0); }
  fs.writeFileSync(f, old.replace(/;+$/, '') ? old.replace(/;+$/, '') + ';' + req.dir : req.dir);
  process.stdout.write('added');
  process.exit(0);
}
process.stderr.write('unknown script\\n');
process.exit(3);
`;

/** A fake PowerShell in `dir`: {bin, creds(), userPath(), setUserPath(v), argvText(), fail(msg)}. */
function makeFakePowerShell(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, 'powershell.js');
  fs.writeFileSync(bin, SCRIPT);
  const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
  return {
    bin,
    creds: () => { try { return JSON.parse(read('creds.json')); } catch { return {}; } },
    userPath: () => read('userpath.txt'),
    setUserPath: (v) => fs.writeFileSync(path.join(dir, 'userpath.txt'), v),
    argvText: () => read('argv.log'),
    fail: (msg) => (msg === null ? fs.rmSync(path.join(dir, 'fail'), { force: true }) : fs.writeFileSync(path.join(dir, 'fail'), msg)),
  };
}

/**
 * A fake reg.exe as a spawnSync stand-in (win/registry.js's `run` option): keys in a Map, every call in
 * `calls`. Answers like reg.exe: `add <key> /ve /t REG_SZ /d <v> /f`, `query <key> /ve`, `delete <key> /f`.
 */
function makeFakeReg({ label = '(Default)' } = {}) {
  const keys = new Map();
  const calls = [];
  const run = (file, args) => {
    calls.push({ file, args });
    const [op, key] = args;
    const k = key.toLowerCase();
    if (op === 'add') {
      const v = args[args.indexOf('/d') + 1];
      keys.set(k, v);
      return { status: 0, stdout: 'The operation completed successfully.\r\n', stderr: '' };
    }
    if (op === 'query') {
      if (!keys.has(k)) return { status: 1, stdout: '', stderr: 'ERROR: The system was unable to find the specified registry key or value.\r\n' };
      return { status: 0, stdout: `\r\n${key}\r\n    ${label}    REG_SZ    ${keys.get(k)}\r\n\r\n`, stderr: '' };
    }
    if (op === 'delete') {
      if (!keys.delete(k)) return { status: 1, stdout: '', stderr: 'ERROR: The system was unable to find the specified registry key or value.\r\n' };
      return { status: 0, stdout: 'The operation completed successfully.\r\n', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: 'ERROR: Invalid syntax.\r\n' };
  };
  return { run, keys, calls, get: (key) => keys.get(key.toLowerCase()) };
}

module.exports = { makeFakePowerShell, makeFakeReg };

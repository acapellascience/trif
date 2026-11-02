'use strict';
// Stand-ins for /usr/bin/security and libsecret's secret-tool (helper/lib/keyring.js, through
// TRIF_KEYCHAIN_BIN), so tests never touch the real Keychain. Items live in items.json next to the
// script; every call's argv (never its stdin) is appended to argv.log, so tests can check a key never
// appears in a command line.

const fs = require('fs');
const path = require('path');

const COMMON = `
const fs = require('fs');
const path = require('path');
const STORE = path.join(__dirname, 'items.json');
const load = () => { try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return {}; } };
const save = (o) => fs.writeFileSync(STORE, JSON.stringify(o));
fs.appendFileSync(path.join(__dirname, 'argv.log'), JSON.stringify(process.argv.slice(2)) + '\\n');
const readStdin = () => { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } };
`;

// security: find-generic-password [-w], add-generic-password (-w | -X hex) [-U], delete-generic-password,
// and -i (commands on stdin, double quotes allowed). Exit 44 when an item isn't found, like the real one.
const SECURITY = `#!${process.execPath}
'use strict';
${COMMON}
function opts(cmd, args) {
  const o = { flags: new Set() };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (['-s', '-a', '-l', '-w', '-X', '-j'].includes(a) && i + 1 < args.length && !(a === '-w' && cmd === 'find-generic-password')) o[a] = args[++i];
    else o.flags.add(a);
  }
  return o;
}
function command(args) {
  const [cmd, ...rest] = args;
  const o = opts(cmd, rest);
  const items = load();
  const id = (o['-s'] || '') + '\\u0000' + (o['-a'] || '');
  if (cmd === 'find-generic-password') {
    if (!(id in items)) { process.stderr.write('security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\\n'); return 44; }
    if (rest.includes('-w')) process.stdout.write(items[id] + '\\n');
    else process.stdout.write('keychain: "/fake.keychain-db"\\nattributes:\\n    "svce"<blob>="' + o['-s'] + '"\\n');
    return 0;
  }
  if (cmd === 'add-generic-password') {
    if (!o['-s'] || !o['-a']) return 2;
    if (id in items && !o.flags.has('-U')) { process.stderr.write('security: SecKeychainItemCreateFromContent: The specified item already exists in the keychain.\\n'); return 45; }
    items[id] = o['-X'] !== undefined ? Buffer.from(o['-X'], 'hex').toString('utf8') : o['-w'];
    save(items);
    return 0;
  }
  if (cmd === 'delete-generic-password') {
    if (!(id in items)) { process.stderr.write('security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\\n'); return 44; }
    delete items[id];
    save(items);
    return 0;
  }
  process.stderr.write('unknown command ' + cmd + '\\n');
  return 1;
}
function words(line) {
  const out = [];
  const re = /"([^"]*)"|(\\S+)/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}
const argv = process.argv.slice(2);
if (argv[0] === '-i') {
  let code = 0;
  for (const line of readStdin().split('\\n')) if (line.trim()) code = command(words(line));
  process.exit(code);
}
process.exit(command(argv));
`;

// secret-tool: store --label=L <attrs> (secret on stdin), lookup <attrs>, clear <attrs>.
const SECRET_TOOL = `#!${process.execPath}
'use strict';
${COMMON}
const [cmd, ...rest] = process.argv.slice(2);
const attrs = rest.filter((a) => !a.startsWith('--'));
const id = attrs.join('\\u0000');
const items = load();
if (cmd === 'store') { items[id] = readStdin(); save(items); process.exit(0); }
if (cmd === 'lookup') { if (!(id in items)) process.exit(1); process.stdout.write(items[id]); process.exit(0); }
if (cmd === 'clear') { delete items[id]; save(items); process.exit(0); }
process.exit(2);
`;

/** A fake keychain in `dir`: {bin, env, items(), argv(), argvText()}. kind: 'security' | 'secret-tool'. */
function makeFakeKeychain(dir, { kind = 'security' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, kind);
  fs.writeFileSync(bin, kind === 'security' ? SECURITY : SECRET_TOOL);
  fs.chmodSync(bin, 0o755);
  const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
  return {
    bin,
    env: { TRIF_KEYCHAIN_BIN: bin },
    items: () => { try { return JSON.parse(read('items.json')); } catch { return {}; } },
    argv: () => read('argv.log').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    argvText: () => read('argv.log'),
  };
}

module.exports = { makeFakeKeychain };

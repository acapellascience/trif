'use strict';
// TRIF's full sandbox signed in with `claude setup-token` (helper/lib/claudetoken.js, logins.js mode "token";
// docs/WHOLE-BOX-PROGRESS.md step 6). Stand-ins only: a fake `claude` as TRIF's pinned copy, a fake keychain
// (tests/fake-keychain.js), made-up tokens. Never anyone's login.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ct = require('../helper/lib/claudetoken');
const { makeFakeKeychain } = require('./fake-keychain');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trif-ctoken-'));
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
let n = 0;
const fresh = (name) => { const d = path.join(tmpRoot, `${name}-${++n}`); fs.mkdirSync(d, { recursive: true }); return d; };
const FAKE_TOKEN = 'sk-ant-oat01-' + 'Stand_in-token-'.repeat(6) + 'AA';

test('setup-token\'s lines: the sign-in URL, the token taken out (its line redacted), anything sk-ant-… never passed on', () => {
  assert.deepStrictEqual(ct.parseSetupTokenLine('If the browser didn\'t open, visit: https://claude.com/cai/oauth/authorize?code=true&state=x'),
    { kind: 'login', url: 'https://claude.com/cai/oauth/authorize?code=true&state=x' });
  assert.deepStrictEqual(ct.parseSetupTokenLine('https://claude.ai/oauth/authorize?code=true&x=1'), { kind: 'login', url: 'https://claude.ai/oauth/authorize?code=true&x=1' });
  assert.strictEqual(ct.parseSetupTokenLine('Opening browser to sign in…'), null);
  assert.deepStrictEqual(ct.parseSetupTokenLine(FAKE_TOKEN), { kind: 'token', token: FAKE_TOKEN, text: '[token]' });
  assert.deepStrictEqual(ct.parseSetupTokenLine(`  export CLAUDE_CODE_OAUTH_TOKEN=${FAKE_TOKEN}`), { kind: 'token', token: FAKE_TOKEN, text: 'export CLAUDE_CODE_OAUTH_TOKEN=[token]' });
  // (the prompt shares its line with what comes next)
  assert.deepStrictEqual(ct.parseSetupTokenLine(`Paste code here if prompted > ${FAKE_TOKEN}`).token, FAKE_TOKEN);
  // an API key, a refresh token, anything sk-ant-: redacted, never a "token" TRIF keeps
  assert.deepStrictEqual(ct.parseSetupTokenLine('oops sk-ant-api03-abcdefghijklmnopqrstuvwxyz and sk-ant-ort01-zzzz'), { kind: 'text', text: 'oops [token] and [token]' });
  assert.deepStrictEqual(ct.parseSetupTokenLine('Store this token securely.'), { kind: 'text', text: 'Store this token securely.' });
  assert.strictEqual(ct.parseSetupTokenLine('sk-ant-oat01-short').kind, 'text', 'too short to be one');
});

test('a boxed run\'s env with the token: the variables that would outrank it (or send it elsewhere) removed', () => {
  const env = ct.tokenEnv({ PATH: '/usr/bin', ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_USE_FOUNDRY: '1', KEEP: 'x' }, FAKE_TOKEN);
  assert.deepStrictEqual(env, { PATH: '/usr/bin', KEEP: 'x', CLAUDE_CODE_OAUTH_TOKEN: FAKE_TOKEN });
  assert.throws(() => ct.tokenEnv({}, 'sk-ant-api03-notatoken-xxxxxxxxxxxxxxxx'), /isn't a Claude Code sign-in token/);
  assert.throws(() => ct.tokenEnv({}, ''), /isn't a Claude Code sign-in token/);
});

test('kept in the keyring (a stand-in): stored by stdin, never in a command line; read back; removed', async () => {
  const kc = makeFakeKeychain(fresh('kc'));
  const o = { env: kc.env };
  assert.deepStrictEqual(await ct.hasToken(o), { stored: false, error: null });
  await ct.storeToken(FAKE_TOKEN, o);
  assert.deepStrictEqual(await ct.readToken(o), { value: FAKE_TOKEN, error: null });
  const argv = fs.readFileSync(path.join(path.dirname(kc.env.TRIF_KEYCHAIN_BIN), 'argv.log'), 'utf8');
  assert.ok(!argv.includes(FAKE_TOKEN) && !argv.includes(Buffer.from(FAKE_TOKEN).toString('hex')), 'never in an argv');
  assert.match(argv, /TRIF Claude Code sign-in/);
  await assert.rejects(ct.storeToken('sk-ant-api03-an-api-key-not-a-token', o), /isn't a Claude Code sign-in token/);
  assert.deepStrictEqual(await ct.removeToken(o), { removed: true });
  assert.deepStrictEqual(await ct.readToken(o), { value: null, error: null });
});

// The panel's login flow, mode "token": TRIF's pinned copy (a stand-in) runs `setup-token`, the URL goes to
// the panel, the code back, the token to the keyring and nowhere else (events, helper log, files).
function fakeClaude(dir) {
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, `#!${process.execPath}
const fs = require('fs'); const path = require('path');
const argv = process.argv.slice(2);
fs.writeFileSync(path.join(${JSON.stringify(dir)}, 'call.json'), JSON.stringify({ argv, env: process.env, tty: !!process.stdin.isTTY, columns: process.stdout.columns }));
if (argv[0] !== 'setup-token') { process.stderr.write('unexpected ' + argv.join(' ')); process.exit(3); }
// (as the real one, round 2's CI probe: without a terminal, a newline and a wait)
if (!process.stdin.isTTY) { process.stdout.write('\\n'); setInterval(() => {}, 1000); return; }
// (a terminal UI reads keys: Return is \\r, nothing echoed)
process.stdin.setRawMode(true);
// (drawn as the real one does, round 3's CI probe: Ink's cursor moves for spaces, a logo, spinners, a box)
// (ink(text, at): text drawn from column "at" (0-based), each word placed by an absolute column move)
const ink = (t, at = 0) => t.split(' ').map((w, i, a) => (i ? '\\x1b[' + (at + a.slice(0, i).join(' ').length + 2) + 'G' : '') + w).join('');
process.stdout.write('\\x1b7\\x1b8' + ink('Welcome to Claude Code v2.1.330') + '\\r\\n*█████▓▓░\\r\\n\\x1b[1C' + ink('· Opening browser to sign in…', 1) + '\\r\\n✢\\r✳\\r\\n');
process.stdout.write(ink("Browser didn't open? Use the url below to sign in (c to copy)") + '\\r\\n\\r\\n\\x1b]8;;https://claude.ai/oauth/authorize?code=true&state=SECRETSTATE\\x07https://claude.ai/oauth/authorize?code=true&state=SECRETSTATE\\x1b]8;;\\x07\\r\\n\\r\\n');
process.stdout.write(ink('Paste code here if prompted') + '\\r\\n╭──────╮\\r\\n│ │\\r\\n╰──────╯\\x1b(B\\x0f');
let buf = '';
process.stdin.on('data', (d) => { buf += d; if (!buf.includes('\\r')) return;
  const code = buf.trim();
  // (a code it doesn't take: it says so and waits for Return, round 3's CI probe)
  if (code === 'BADCODE') { process.stdout.write('\\r\\x1b[1C\\x1b[1A✘\\x1b[4G' + ink("OAuth error: That code wasn't accepted. Sign in again to get a new code.", 3) + '\\r\\r\\n\\x1b[2G' + ink('Press Enter to retry', 1) + '\\r\\n'); buf = ''; return; }
  if (code === 'NOTOKEN') { process.stdout.write('\\nDone.\\n'); process.exit(0); }
  process.stdout.write('\\r\\n✓ ' + ink('Long-lived authentication token created successfully!', 2) + '\\r\\n\\r\\n' + ink('Your OAuth token (valid for 1 year):') + '\\r\\n\\r\\n${FAKE_TOKEN}\\r\\n\\r\\n' + ink("Store this token securely. You won't be able to see it again.") + '\\r\\n');
  // (GOODWAIT: it waits after showing the token: TRIF ends it)
  if (code === 'GOODWAIT') { setInterval(() => {}, 1000); return; }
  process.exit(0);
});
`, { mode: 0o755 });
}

async function tokenLogin(code) {
  const home = fresh('home');
  const kc = makeFakeKeychain(fresh('kc'));
  const cp = require('../helper/lib/claudepin');
  const key = `${process.platform}-${process.arch}`;
  const pinFile = path.join(fresh('pin'), 'pin.json');
  fs.writeFileSync(pinFile, JSON.stringify({ version: '2.1.999', packages: { [key]: { name: 'x' } } }));
  const saved = { pin: process.env.TRIF_CLAUDE_CODE_PIN, kc: process.env.TRIF_KEYCHAIN_BIN };
  process.env.TRIF_CLAUDE_CODE_PIN = pinFile;
  process.env.TRIF_KEYCHAIN_BIN = kc.env.TRIF_KEYCHAIN_BIN;
  try {
    const dir = path.join(cp.root(home), cp.dirName(key, { version: '2.1.999' }));
    fs.mkdirSync(dir, { recursive: true });
    fakeClaude(dir);
    fs.writeFileSync(path.join(dir, cp.MARK), '{}');
    const { Logins } = require('../helper/lib/logins');
    const events = [];
    const logged = [];
    const logger = { info: (m) => logged.push(m), warn: (m) => logged.push(m), error: (m) => logged.push(m), debug() {} };
    let done;
    const finished = new Promise((r) => { done = r; });
    const logins = new Logins({ getWorkspace: () => ({ home, bin: path.join(home, 'bin'), config: {} }), logger,
      onEvent: (id, ev) => { events.push(ev); if (ev.kind === 'login') logins.code(id, code); if (ev.kind === 'done') done(); } });
    assert.throws(() => logins.start({ agent: 'claude', mode: 'other' }), /unknown login mode/);
    logins.start({ agent: 'claude', mode: 'token' });
    await finished;
    const call = JSON.parse(fs.readFileSync(path.join(dir, 'call.json'), 'utf8'));
    const token = await ct.readToken({ env: kc.env });
    return { events, logged, call, token, home, dir };
  } finally {
    for (const [k, v] of [['TRIF_CLAUDE_CODE_PIN', saved.pin], ['TRIF_KEYCHAIN_BIN', saved.kc]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('the panel\'s sign-in, mode "token": TRIF\'s copy runs setup-token; the token goes to the keyring, nowhere else', async () => {
  const r = await tokenLogin('GOODCODE');
  assert.deepStrictEqual(r.call.argv, ['setup-token']);
  assert.match(r.call.env.CLAUDE_CONFIG_DIR, /trif-setup-token-/, 'a config folder of its own');
  assert.strictEqual(fs.existsSync(r.call.env.CLAUDE_CONFIG_DIR), false, 'removed after');
  assert.strictEqual(r.call.env.DISABLE_AUTOUPDATER, '1');
  assert.deepStrictEqual(r.events.filter((e) => e.kind === 'login'), [{ kind: 'login', url: 'https://claude.ai/oauth/authorize?code=true&state=SECRETSTATE' }]);
  // (only its words, as on screen: no logo, spinners, box, nor its own instructions)
  assert.deepStrictEqual(r.events.filter((e) => e.kind === 'text').map((e) => e.text), ['Long-lived authentication token created successfully!', 'Your OAuth token (valid for 1 year):', 'Store this token securely. You won\'t be able to see it again.']);
  assert.deepStrictEqual(r.events.at(-1), { kind: 'done', ok: true, login: true, mode: 'token' });
  assert.strictEqual(r.call.tty, true, 'under a pseudo-terminal');
  assert.strictEqual(r.call.columns, 4000, 'wide: nothing wrapped');
  assert.strictEqual(r.token.value, FAKE_TOKEN, 'in the keyring');
  const seen = JSON.stringify(r.events) + r.logged.join('\n');
  assert.ok(!seen.includes(FAKE_TOKEN) && !seen.includes('sk-ant-oat'), 'never in an event or the log');
  assert.ok(!r.logged.join('\n').includes('SECRETSTATE'), 'the URL\'s query string never in the log');
  assert.ok(!r.logged.join('\n').includes('GOODCODE'), 'nor the code');
  // (nothing written beside the copy but what the stand-in itself wrote)
  assert.deepStrictEqual(fs.readdirSync(r.dir).sort(), ['.trif-claude-code.json', 'call.json', 'claude']);
});

test('setup-token failing, or printing no token: done not ok, a message, nothing kept; without TRIF\'s copy: refused', async () => {
  const bad = await tokenLogin('BADCODE');
  assert.deepStrictEqual(bad.events.at(-1), { kind: 'done', ok: false, login: true, mode: 'token' });
  assert.match(bad.events.find((e) => e.kind === 'error').message, /^Signing in to Claude Code for TRIF's full sandbox failed: OAuth error: That code wasn't accepted\. Sign in again to get a new code\.$/);
  assert.ok(bad.events.some((e) => e.kind === 'text' && /That code wasn't accepted/.test(e.text)), 'the panel sees it while checking');
  const waits = await tokenLogin('GOODWAIT');
  assert.deepStrictEqual(waits.events.at(-1), { kind: 'done', ok: true, login: true, mode: 'token' }, 'it waited after the token: ended, signed in');
  assert.strictEqual(waits.token.value, FAKE_TOKEN);
  assert.strictEqual(bad.token.value, null);
  const none = await tokenLogin('NOTOKEN');
  assert.match(none.events.find((e) => e.kind === 'error').message, /didn't find a sign-in token/);
  assert.strictEqual(none.token.value, null);
  const { Logins } = require('../helper/lib/logins');
  const logins = new Logins({ getWorkspace: () => ({ home: fresh('empty'), bin: '/nowhere', config: {} }) });
  assert.throws(() => logins.start({ agent: 'claude', mode: 'token' }), /TRIF's own copy of Claude Code isn't downloaded yet/);
  assert.throws(() => logins.start({ agent: 'codex', mode: 'token' }), /has no sign-in token|can't log in from the side panel/);
});

test('a boxed run\'s sign-in (prepareBoxed): a saved API key\'s proxy first; else the token, through the allowlist proxy; neither: "sign in"', async () => {
  const kc = makeFakeKeychain(fresh('kc'));
  // A saved API key: the claude adapter's own prepare (the key proxy), untouched.
  const keyed = { env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:1/', ANTHROPIC_API_KEY: 'placeholder' }, secrets: ['k'] };
  assert.strictEqual(await ct.prepareBoxed({ keyPrep: async () => keyed, env: kc.env }), keyed);
  // Neither: an error the run turns into a sign-in offer.
  await assert.rejects(ct.prepareBoxed({ keyPrep: async () => ({}), env: kc.env }), (e) => e.signIn === 'token' && /need you to sign in to Claude Code for TRIF first/.test(e.message));
  // The token: CLAUDE_CODE_OAUTH_TOKEN; what would outrank it unset; Anthropic through the allowlist proxy.
  await ct.storeToken(FAKE_TOKEN, { env: kc.env });
  let closed = 0;
  const p = await ct.prepareBoxed({ keyPrep: async () => ({}), env: kc.env, startProxy: async (o) => { assert.deepStrictEqual(o, {}); return { port: 4567, close: async () => { closed++; } }; } });
  assert.deepStrictEqual(p.env, { CLAUDE_CODE_OAUTH_TOKEN: FAKE_TOKEN, HTTPS_PROXY: 'http://127.0.0.1:4567' });
  for (const v of [...ct.OUTRANKS, 'ANTHROPIC_BASE_URL']) assert.ok(p.unsetEnv.includes(v), v);
  assert.deepStrictEqual(p.secrets, [FAKE_TOKEN], 'redacted from everything the run says');
  assert.deepStrictEqual(p.state, { signIn: 'token' });
  await p.cleanup();
  assert.strictEqual(closed, 1);
  // (tests: TRIF_ANTHROPIC_URL, a stand-in on this computer, instead of the proxy)
  const s = await ct.prepareBoxed({ keyPrep: async () => ({}), env: { ...kc.env, TRIF_ANTHROPIC_URL: 'http://127.0.0.1:9/' }, startProxy: () => { throw new Error('not used'); } });
  assert.deepStrictEqual(s.env, { CLAUDE_CODE_OAUTH_TOKEN: FAKE_TOKEN, ANTHROPIC_BASE_URL: 'http://127.0.0.1:9/' });
  assert.ok(!s.unsetEnv.includes('ANTHROPIC_BASE_URL') && s.unsetEnv.includes('ANTHROPIC_API_KEY'));
  assert.strictEqual(s.cleanup, null);
  // A keyring item that isn't a token: "sign in again", the item's text never in the message.
  const kc2 = makeFakeKeychain(fresh('kc'));
  await require('../helper/lib/keyring').setKey(ct.ACCOUNT, 'sk-ant-api03-not-a-setup-token-xx', { service: ct.SERVICE, env: kc2.env });
  await assert.rejects(ct.prepareBoxed({ env: kc2.env }), (e) => e.signIn === 'token' && /sign in again/.test(e.message) && !e.message.includes('sk-ant'));
});

test('the pseudo-terminal (macOS): the program sees a wide terminal, gets what is typed with Return, its exit status comes back; cancelled, it ends', { skip: process.platform !== 'darwin' && 'macOS only' }, async () => {
  const { spawn } = require('child_process');
  const prog = path.join(fresh('pty'), 'prog');
  fs.writeFileSync(prog, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({ tty: process.stdin.isTTY, cols: process.stdout.columns }) + '\\nname> ');\nprocess.stdin.setRawMode(true);\nlet b = '';\nprocess.stdin.on('data', (d) => { b += d; if (b.includes('\\r')) { process.stdout.write('got ' + b.trim() + '\\n'); process.exit(b.startsWith('wait') ? 0 : 7); } });\n`, { mode: 0o755 });
  assert.strictEqual(ct.ptyCommand(prog, [], { platform: 'win32' }), null);
  const run = (typed, { cancel = false } = {}) => new Promise((resolve) => {
    const c = ct.ptyCommand(prog, []);
    const child = spawn(c.file, c.args, { stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; if (/name> $/.test(out)) { if (cancel) process.kill(-child.pid, 'SIGTERM'); else child.stdin.write(typed); } });
    // (a watchdog: the repo's whole suite once hung here for 180 s, round 6; now it fails saying what it saw)
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } resolve({ out, code: null, signal: null, hung: true }); }, 30000);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ out, code, signal }); });
  });
  const r = await run('abc\r');
  assert.ok(!r.hung, `hung (typed): ${JSON.stringify(r.out)}`);
  assert.match(r.out, /"tty":true,"cols":4000/);
  assert.match(r.out, /got abc/);
  assert.strictEqual(r.code, 7, 'the program\'s exit status');
  const c = await run('', { cancel: true });
  assert.ok(!c.hung, `hung (cancelled): ${JSON.stringify(c.out)}`);
  assert.strictEqual(c.signal, 'SIGTERM');
  assert.doesNotMatch(c.out, /got/);
});

'use strict';
// TRIF's full sandbox, signed in with `claude setup-token` (docs/WHOLE-BOX-PROGRESS.md step 6).
//
// Inside the box Claude Code can't read its own login (a Keychain item it reads with /usr/bin/security:
// the box would need securityd, and then anything in it could ask for any item that trusts that program;
// docs/WHOLE-BOX.md). So a boxed run signs in with the documented long-lived token instead
// (code.claude.com/docs/en/authentication): `claude setup-token` opens the same browser sign-in as /login
// and prints a one-year OAuth token, saving it nowhere. TRIF runs it once, outside the box (logins.js,
// mode "token": the panel shows the URL and takes the code as for `claude auth login`), keeps the token in
// the system keyring through the helper (keyring.js; never in a file, never in a log, never in an event),
// and gives it to each boxed run as CLAUDE_CODE_OAUTH_TOKEN.
//
// Precedence (the docs, highest first): cloud-provider variables (Bedrock, Vertex, Foundry) >
// ANTHROPIC_AUTH_TOKEN > ANTHROPIC_API_KEY > apiKeyHelper > CLAUDE_CODE_OAUTH_TOKEN > the /login one. So
// `tokenEnv` removes the higher variables from a boxed run's environment (an organization's apiKeyHelper in
// managed settings still wins: step 5). The token "can only make model requests" (no Remote Control, no
// claude.ai connectors). API keys keep working as now, through the key proxy (agentkeys.js).
//
// The exact output of `setup-token` isn't documented: whatever line holds the token, it's taken from there
// and the line is passed on with the token replaced. Tokens look like sk-ant-oat01-<base64url>; any
// sk-ant-… string is redacted from every line, whatever its kind.

const keyring = require('./keyring');

const SERVICE = 'TRIF Claude Code sign-in';
const ACCOUNT = 'claude-setup-token';
const TOKEN_RE = /\bsk-ant-oat\d{2}-[A-Za-z0-9_-]{16,}/;
const ANY_ANTHROPIC_SECRET = /\bsk-ant-[A-Za-z0-9_-]+/g;
// Variables that would win over CLAUDE_CODE_OAUTH_TOKEN, or send the run somewhere else.
const OUTRANKS = ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'];

const redactTokens = (text) => String(text).replace(ANY_ANTHROPIC_SECRET, '[token]');

/**
 * One line of a terminal UI's output as it would look on screen (round 3's CI probe: Claude Code's
 * setup-token draws with Ink, which moves the cursor between words, ESC[<n>G and ESC[<n>C, rather than
 * printing spaces): those moves become spaces, every other escape sequence and control character goes.
 * Within the line (logins.js splits at \r and \n), the text is drawn left to right, later over earlier.
 */
function termLine(raw) {
  const cells = [];
  let col = 0;
  const str = String(raw);
  for (let i = 0; i < str.length;) {
    const c = str[i];
    if (c === '\x1b') {
      const csi = /^\x1b\[([0-?]*)[ -/]*([@-~])/.exec(str.slice(i, i + 32));
      if (csi) {
        const n = Math.max(1, parseInt(csi[1], 10) || 1);
        if (csi[2] === 'G') col = Math.min(n - 1, 8000);
        else if (csi[2] === 'C') col = Math.min(col + n, 8000);
        else if (csi[2] === 'D') col = Math.max(0, col - n);
        i += csi[0].length;
        continue;
      }
      const osc = /^\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/.exec(str.slice(i, i + 4096));
      if (osc) { i += osc[0].length; continue; }
      i += /^\x1b[()*+#%][\s\S]/.test(str.slice(i, i + 3)) ? 3 : 2; // (a character set; ESC 7, ESC 8, …)
      continue;
    }
    const cp = str.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    i += ch.length;
    if (cp < 0x20 || cp === 0x7f || (cp >= 0x80 && cp < 0xa0)) continue;
    while (cells.length < col) cells.push(' ');
    cells[col++] = ch;
  }
  return cells.join('').replace(/\s+$/, '');
}
// What setup-token draws that says nothing to the person (its logo, spinners, box borders, its own
// instructions, which the panel gives in its own words): not passed on.
const CHROME = /^(welcome to claude code|this will guide you|·?\s*opening browser|browser didn.t open|paste code here|finishing sign|press enter to retry)/i;
// Its answer to a code it didn't take (round 3's CI probe: "✘ OAuth error: That code wasn't accepted. …",
// then "Press Enter to retry", and it waits).
const REFUSED_CODE = /^OAuth error\b|\bcode wasn.t accepted\b/i;

/**
 * One line of `claude setup-token` output -> {kind:"token", token, text} | {kind:"login", url} |
 * {kind:"text", text} | null. `text` never holds the token (nor any sk-ant-… string).
 */
function parseSetupTokenLine(line) {
  const raw = String(line);
  const tok = TOKEN_RE.exec(raw);
  const t = redactTokens(raw).replace(/^\s*paste code here[^>]*>/i, '').trim().replace(/^[✘✗×✔✓·*✢✳✶✻✽]\s*/u, '');
  if (tok) return { kind: 'token', token: tok[0], text: t };
  if (!t || !/[A-Za-z]{3}/.test(t) || CHROME.test(t)) return null;
  if (REFUSED_CODE.test(t)) return { kind: 'text', text: t, refused: true };
  const m = /\bvisit:\s*(https:\/\/\S+)/i.exec(t) || /(https:\/\/(?:[a-z0-9-]+\.)*(?:claude\.com|claude\.ai|anthropic\.com)\/\S*oauth\S*)/i.exec(t);
  if (m) return { kind: 'login', url: m[1] };
  return { kind: 'text', text: t };
}

/** The env for a boxed run signed in with `token`: the variables that outrank it removed. */
function tokenEnv(env, token) {
  if (!TOKEN_RE.test(String(token || ''))) throw new Error('that isn\'t a Claude Code sign-in token');
  const out = { ...env };
  for (const k of OUTRANKS) delete out[k];
  out.CLAUDE_CODE_OAUTH_TOKEN = token;
  return out;
}

const opts = (o) => ({ service: SERVICE, ...o });
/** Keep the token in the system keyring. Throws an Error that never contains it. */
async function storeToken(token, o = {}) {
  if (!TOKEN_RE.test(String(token || ''))) throw new Error('that isn\'t a Claude Code sign-in token');
  await keyring.setKey(ACCOUNT, token, opts(o));
}
/** {value, error}: the stored token (the helper's alone: to a boxed run's environment), or null. */
async function readToken(o = {}) {
  const r = await keyring.getKey(ACCOUNT, opts(o));
  if (r.value && !TOKEN_RE.test(r.value)) return { value: null, error: 'the saved Claude Code sign-in isn\'t a token TRIF recognizes; sign in again' };
  return r;
}
const hasToken = (o = {}) => keyring.hasKey(ACCOUNT, opts(o));
const removeToken = (o = {}) => keyring.removeKey(ACCOUNT, opts(o));

// `claude setup-token` prints nothing useful without a terminal (round 2's CI probe: with pipes it prints
// a newline and waits), so it runs under a pseudo-terminal: macOS's own /usr/bin/script (no new
// dependency). script refuses a socket as its stdin (tcgetattr: "Operation not supported on socket"), and
// node's pipes are sockets on macOS, so its stdin comes through `cat` (a real pipe), and cat is stopped
// when script ends (else the shell waits for it). Inside, the terminal is made very wide (stty) so the
// sign-in URL and the token are never wrapped across lines. script's exit status is the program's. The
// terminal echoes what's typed: logins.js redacts the code; the program reads it in raw mode, so the code
// is sent with \r (Return), not \n. Windows: ConPTY (step 9b); elsewhere: null.
const SCRIPT = '/usr/bin/script';
function ptyCommand(file, args = [], { platform = process.platform } = {}) {
  if (platform !== 'darwin') return null;
  const inner = '/bin/stty cols 4000 rows 50 2>/dev/null; exec "$0" "$@"';
  return { file: '/bin/sh', args: ['-c', `/bin/cat | { ${SCRIPT} -q /dev/null /bin/sh -c '${inner}' "$@"; s=$?; /usr/bin/pkill -P $$ -x cat; exit $s; }`, 'sh', file, ...args] };
}

/**
 * A boxed run's sign-in (runs.js, TRIF's full sandbox): {env, unsetEnv, secrets, cleanup, state} as an
 * adapter's prepare gives (runs.js _withAgent). A saved API key: the key proxy, as now (`keyPrep`, the
 * claude adapter's own prepare). Else the setup-token token from the keyring, as CLAUDE_CODE_OAUTH_TOKEN
 * (the variables that outrank it unset), Anthropic reached through TRIF's network relay (relay.js via wholebox.js
 * startProxy, the box's one way out; TRIF_ANTHROPIC_URL, tests: a stand-in on this computer instead).
 * No token: throws an Error with .signIn = 'token' (the run says so; the panel offers the sign-in).
 */
async function prepareBoxed({ keyPrep = async () => ({}), env = process.env, keyringOpts = {}, startProxy = (o) => require('./wholebox').startProxy(o) } = {}) {
  const k = (await keyPrep()) || {};
  if (k.env && k.env.ANTHROPIC_BASE_URL) return k;
  if (typeof k.cleanup === 'function') { try { await k.cleanup(); } catch { /* nothing started */ } }
  const r = await readToken({ env, ...keyringOpts });
  if (!r.value) {
    const e = new Error(r.error
      ? `TRIF's full sandbox couldn't read your Claude Code sign-in (${redactTokens(r.error)}): sign in again.`
      : 'Chats in TRIF\'s full sandbox need you to sign in to Claude Code for TRIF first.');
    e.signIn = 'token';
    throw e;
  }
  const stand = require('./env').envVar('ANTHROPIC_URL', env);
  let proxy = null;
  if (!stand) proxy = await startProxy({});
  return {
    env: { CLAUDE_CODE_OAUTH_TOKEN: r.value, ...(stand ? { ANTHROPIC_BASE_URL: stand } : { HTTPS_PROXY: `http://127.0.0.1:${proxy.port}` }) },
    unsetEnv: [...OUTRANKS, ...(stand ? [] : ['ANTHROPIC_BASE_URL'])],
    secrets: [r.value],
    cleanup: proxy ? () => proxy.close() : null,
    ...(proxy ? { proxySeen: proxy.seen } : {}), // (what it refused: boxrefusals.js)
    state: { signIn: 'token' },
  };
}

module.exports = { SERVICE, ACCOUNT, TOKEN_RE, OUTRANKS, redactTokens, termLine, parseSetupTokenLine, tokenEnv, storeToken, readToken, hasToken, removeToken, ptyCommand, prepareBoxed };

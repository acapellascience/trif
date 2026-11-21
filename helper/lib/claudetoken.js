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
 * One line of `claude setup-token` output -> {kind:"token", token, text} | {kind:"login", url} |
 * {kind:"text", text} | null. `text` never holds the token (nor any sk-ant-… string).
 */
function parseSetupTokenLine(line) {
  const raw = String(line);
  const tok = TOKEN_RE.exec(raw);
  const t = redactTokens(raw).replace(/^\s*paste code here[^>]*>/i, '').trim();
  if (tok) return { kind: 'token', token: tok[0], text: t };
  if (!t || /^opening browser/i.test(t)) return null;
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

module.exports = { SERVICE, ACCOUNT, TOKEN_RE, OUTRANKS, redactTokens, parseSetupTokenLine, tokenEnv, storeToken, readToken, hasToken, removeToken };

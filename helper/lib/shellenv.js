'use strict';
// Reading one environment variable the way the user's terminal has it, for the helper Chrome starts
// (whose environment has none of the user's shell profile). Used for open-model API keys
// (agents/codex-oss.js): the user exports e.g. OPENROUTER_API_KEY in ~/.zshrc and TRIF only ever
// stores the variable's NAME. The value stays in memory: never written to a file, a log or an error.
//
// Where it looks, in order:
//   1. the helper's own environment (Chrome started from a terminal, or `launchctl setenv`);
//   2. the user's login shell, interactive so ~/.zshrc / ~/.bashrc are read: `<shell> -l -i -c
//      'printf <begin>; /usr/bin/printenv NAME; printf <end>'`, stdin closed, 10 s limit. The markers
//      skip whatever the profile prints. Done once the end marker is out (a job the profile starts in the
//      background may hold the output open); then the shell's process group is killed. NAME is checked
//      against a strict pattern (and NOT_A_KEY) before it gets near the command line.
// Found values are kept for 10 minutes (a profile that's slow to start shouldn't slow every run).

const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { envVar } = require('./env');

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map(); // name -> {at, value, source}

function validName(name) { return typeof name === 'string' && NAME_RE.test(name); }

// Variables that are never an API key, and whose values a key setting mustn't send to a model server:
// the system's and the shell's own, the loader's, and TRIF's, Codex's and Claude Code's (TRIF_RUN_TOKEN
// among them). Matched ignoring case.
const NOT_A_KEY = new RegExp('^(?:' + [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'PWD', 'OLDPWD', 'LANG', 'LANGUAGE', 'TERM', 'TERM_.*', 'TZ',
  'EDITOR', 'VISUAL', 'PAGER', 'MAIL', 'HOSTNAME', 'HOST', 'DISPLAY', 'IFS', 'PS[1-4]', 'PROMPT', 'ENV', 'BASH_ENV', 'BASH_.*', 'ZDOTDIR',
  'CDPATH', 'FPATH', 'MANPATH', 'INFOPATH', 'SHLVL', '_', 'COLUMNS', 'LINES', 'UID', 'EUID', 'PPID', 'SECURITYSESSIONID',
  'COMMAND_MODE', 'SSH_.*', 'XPC_.*', '__CF.*', 'APPLE_.*', 'LC_.*', 'DYLD_.*', 'LD_.*', 'NODE_.*', 'NPM_.*', 'XDG_.*', 'HOMEBREW_.*',
  'TRIF_.*', 'WEBMODS_.*', 'CODEX_.*', 'CLAUDE_.*', 'CLAUDECODE',
].join('|') + ')$', 'i');

/** Why `name` can't be an API key's variable ('' when it can): not a valid name, or a well-known one. */
function keyNameProblem(name) {
  if (!validName(name)) return 'give the NAME of the environment variable holding the key (like OPENROUTER_API_KEY), not the key';
  if (NOT_A_KEY.test(name)) return `${name} is one of the system's, the shell's or TRIF's own variables, not an API key's: give the name of the variable holding the key (like OPENROUTER_API_KEY)`;
  return '';
}

function userShell() {
  // (TRIF_KEY_SHELL: a stand-in shell for tests.)
  const forced = envVar('KEY_SHELL');
  if (forced && forced.startsWith('/')) return forced;
  let sh = '';
  try { sh = os.userInfo().shell || ''; } catch { /* below */ }
  if (!sh || !sh.startsWith('/')) sh = process.env.SHELL || '';
  return sh && sh.startsWith('/') ? sh : '/bin/zsh';
}

/**
 * Resolves {value, source: 'helper'|'shell'|null, error}. value is null when it isn't set anywhere
 * (error says why, without the value). Never rejects. opts: {env, shell, timeout, fresh}.
 */
function lookupEnvVar(name, { env = process.env, shell = userShell(), timeout = 10000, fresh = false } = {}) {
  if (!validName(name)) return Promise.resolve({ value: null, source: null, error: `"${String(name).slice(0, 40)}" isn't a valid environment variable name` });
  if (keyNameProblem(name)) return Promise.resolve({ value: null, source: null, error: keyNameProblem(name) });
  if (typeof env[name] === 'string' && env[name]) return Promise.resolve({ value: env[name], source: 'helper', error: null });
  const hit = cache.get(name);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve({ value: hit.value, source: hit.source, error: null });
  const tag = crypto.randomBytes(6).toString('hex');
  const begin = `__TRIF_${tag}_BEGIN__`;
  const end = `__TRIF_${tag}_END__`;
  const script = `printf '%s' '${begin}'; /usr/bin/printenv ${name}; printf '%s' '${end}'`;
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    // Done as soon as the end marker is out (a profile's background job can keep stdout open long after),
    // then the shell's whole process group goes (it was started in a group of its own).
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } } };
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); if (child) kill(); resolve(r); } };
    let child;
    try {
      // HOME/USER/PATH basics so the profile behaves as in a terminal; nothing else from the helper.
      const base = { HOME: os.homedir(), USER: env.USER || '', LOGNAME: env.LOGNAME || env.USER || '', PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TERM: 'dumb', SHELL: shell };
      if (env.LANG) base.LANG = env.LANG;
      child = spawn(shell, ['-l', '-i', '-c', script], { env: base, cwd: os.homedir(), stdio: ['ignore', 'pipe', 'ignore'], detached: true });
    } catch (e) {
      finish({ value: null, source: null, error: `couldn't start your shell (${shell}): ${e.message}` });
      return;
    }
    const timer = setTimeout(() => {
      finish({ value: null, source: null, error: `your shell (${shell}) took more than ${Math.round(timeout / 1000)} s to start` });
    }, timeout);
    // The value, once both markers are out; null before.
    const parse = () => {
      const a = out.indexOf(begin);
      const b = a === -1 ? -1 : out.indexOf(end, a + begin.length);
      if (b === -1) return null;
      const value = out.slice(a + begin.length, b).replace(/\r?\n$/, '');
      if (!value) return { value: null, source: null, error: `${name} isn't set in your shell (${shell}) or the helper's environment` };
      cache.set(name, { at: Date.now(), value, source: 'shell' });
      return { value, source: 'shell', error: null };
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      if (out.length < 1 << 20) out += d;
      const r = parse();
      if (r) finish(r);
    });
    child.on('error', (e) => finish({ value: null, source: null, error: `couldn't start your shell (${shell}): ${e.message}` }));
    child.on('close', () => finish(parse() || { value: null, source: null, error: `couldn't read ${name} from your shell (${shell})` }));
  });
}

function forget(name) { if (name) cache.delete(name); else cache.clear(); }

/** `text` with every occurrence of each secret (8+ characters) replaced by [redacted]. */
function redactSecrets(text, secrets) {
  let s = String(text ?? '');
  for (const v of secrets || []) if (typeof v === 'string' && v.length >= 8) s = s.split(v).join('[redacted]');
  return s;
}

module.exports = { lookupEnvVar, validName, keyNameProblem, userShell, forget, redactSecrets, NAME_RE, NOT_A_KEY };

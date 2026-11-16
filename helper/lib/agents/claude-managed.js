'use strict';
// Claude Code's managed settings (an organization's policy) and what they do to TRIF's side-panel runs.
//
// Managed settings outrank everything TRIF passes (--settings, --allowedTools): "no user, project, local,
// or `--settings` value overrides them" (code.claude.com/docs/en/settings). They come from, highest first:
//   - server-managed settings, cached at ~/.claude/remote-settings.json
//   - an MDM profile (macOS: the com.anthropic.claudecode managed preferences domain)
//   - managed-settings.json, then every *.json in managed-settings.d/ beside it (not hidden), in
//     alphabetical order: single values, later file wins; lists combine; objects merge key by key
//       macOS  /Library/Application Support/ClaudeCode/      Linux  /etc/claude-code/
// By default Claude Code uses the highest source that has any policy key, but some keys (the sandbox
// locks among them) are read from every source. So each source is checked on its own, and anything one
// of them does counts: that may ask about a setting another source overrides, never miss one.
//
// $TRIF_CLAUDE_MANAGED_DIR replaces every source with files in that folder (managed-settings.json,
// managed-settings.d/, remote-settings.json, com.anthropic.claudecode.plist): for tests, which never read
// the real ones.
//
// What TRIF gives a run (claude.js): the tools Read, Edit, Write, Glob, Grep and Bash (--tools); allow
// rules for reading the workspace, editing sites/ and the commands trif, cd and ls; WebFetch and
// WebSearch denied; and a sandbox for commands (on, failIfUnavailable, no unsandboxed retries, nothing
// auto-allowed, no network, no sockets, reads and writes listed). Each managed setting below either
//   loosens  TRIF's limits: the run would do more than TRIF allows. The user may agree to go on
//            (withoutsandbox.js), and the chat is marked "no TRIF sandbox".
//   breaks   runs: TRIF's own rules are ignored, so a run couldn't do its work. TRIF stops it and says why.
// and everything not listed has no effect on these limits, e.g.
//   - allow rules for WebFetch, WebSearch or any tool --tools leaves out: the tool isn't there, and TRIF's
//     deny rules for WebFetch and WebSearch beat an allow from any level;
//   - sandbox.failIfUnavailable false on macOS, whose sandbox (Seatbelt) is always there;
//   - settings that only restrict (allowManagedDomainsOnly, disableBypassPermissionsMode, deny rules,
//     allowManagedHooksOnly) or that run the organization's own commands (hooks, apiKeyHelper).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { envVar } = require('../env');

const FILE = 'managed-settings.json';
const DROP_INS = 'managed-settings.d';
const PLIST = 'com.anthropic.claudecode.plist';
const REMOTE = 'remote-settings.json';

// The tools a run has (claude.js TOOLS) and the ones that edit: an allow rule for one of them (or for an
// MCP tool) lets the run do more than TRIF's own rules.
const RUN_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash', 'MultiEdit', 'NotebookEdit'];
// The commands TRIF lets runs use (claude.js ALLOWED_TOOLS): excluded from the sandbox, they'd run outside it.
const RUN_COMMANDS = ['trif', 'webmods', 'cd', 'ls'];
const LOOSE_MODES = ['acceptEdits', 'bypassPermissions', 'auto'];

function systemDir(platform = process.platform) {
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode';
  if (platform === 'linux') return '/etc/claude-code';
  return null;
}

function isObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

/** Claude Code's merge of its managed files: later single values win, lists combine, objects key by key. */
function merge(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return [...new Set([...a, ...b].map((x) => JSON.stringify(x)))].map((x) => JSON.parse(x));
  if (isObject(a) && isObject(b)) {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = k in out ? merge(out[k], v) : v;
    return out;
  }
  return b;
}

function readJson(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return e.code === 'ENOENT' || e.code === 'ENOTDIR' ? null : { error: `${file}: ${e.message}` }; }
  if (!text.trim()) return { value: {} }; // (Claude Code reads an empty file as {})
  try {
    const value = JSON.parse(text);
    return isObject(value) ? { value } : { error: `${file} isn't a JSON object` };
  } catch (e) { return { error: `${file} isn't valid JSON (${e.message})` }; }
}

function readPlist(file) {
  if (!fs.existsSync(file)) return null;
  try {
    const out = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    const value = JSON.parse(out);
    return isObject(value) ? { value } : { error: `${file} isn't a dictionary` };
  } catch (e) { return { error: `couldn't read ${file}: ${e.message.split('\n')[0]}` }; }
}

/**
 * The managed settings sources on this computer: [{name, file, settings}] (only those that exist), and
 * `errors` for ones that couldn't be read.
 */
function sources({ dir = envVar('CLAUDE_MANAGED_DIR'), platform = process.platform, homedir = os.homedir(), user = safeUser() } = {}) {
  const test = !!dir;
  const base = test ? path.resolve(dir) : systemDir(platform);
  const out = [];
  const errors = [];
  const take = (name, file, r) => {
    if (!r) return;
    if (r.error) errors.push(r.error);
    else out.push({ name, file, settings: r.value });
  };
  // Server-managed settings, as cached.
  const remote = test ? path.join(base, REMOTE) : path.join(homedir, '.claude', REMOTE);
  const r = readJson(remote);
  // (The cache may hold the settings themselves or wrap them: either way, the settings.)
  if (r && r.value && isObject(r.value.settings)) r.value = r.value.settings;
  take('server-managed settings', remote, r);
  // MDM profile (macOS).
  if (test) take('MDM profile', path.join(base, PLIST), readPlist(path.join(base, PLIST)));
  else if (platform === 'darwin') {
    for (const f of [path.join('/Library/Managed Preferences', user || '-', PLIST), path.join('/Library/Managed Preferences', PLIST)]) take('MDM profile', f, readPlist(f));
  }
  // The files, merged.
  if (base) {
    let merged = null;
    const files = [];
    const main = readJson(path.join(base, FILE));
    if (main && main.error) errors.push(main.error);
    else if (main) { merged = main.value; files.push(path.join(base, FILE)); }
    let names = [];
    try { names = fs.readdirSync(path.join(base, DROP_INS)).filter((n) => n.endsWith('.json') && !n.startsWith('.')).sort(); } catch { /* none */ }
    for (const n of names) {
      const f = path.join(base, DROP_INS, n);
      const x = readJson(f);
      if (!x) continue;
      if (x.error) { errors.push(x.error); continue; }
      merged = merged ? merge(merged, x.value) : x.value;
      files.push(f);
    }
    if (merged) out.push({ name: files.length > 1 ? 'managed settings files' : 'managed settings file', file: files.join(', '), settings: merged });
  }
  return { sources: out, errors };
}

function safeUser() {
  try { return os.userInfo().username; } catch { return ''; }
}

const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);
const firstWord = (cmd) => String(cmd).trim().replace(/(:\*|\s\*|\*)$/, '').split(/\s+/)[0];

/**
 * What one source's settings do to TRIF's runs: {loosens: [...], breaks: [...]}, each a short phrase
 * (docs/CODEX-ORG-STRINGS.md) that follows "Your organization's Claude Code settings …".
 */
function effects(s, { platform = process.platform } = {}) {
  const loosens = [];
  const breaks = [];
  const sb = isObject(s.sandbox) ? s.sandbox : {};
  const fsb = isObject(sb.filesystem) ? sb.filesystem : {};
  const net = isObject(sb.network) ? sb.network : {};
  const perms = isObject(s.permissions) ? s.permissions : {};

  if (sb.enabled === false) loosens.push('turn Claude Code’s sandbox off');
  if (fsb.disabled === true) loosens.push('turn off the sandbox’s limits on files');
  if (sb.failIfUnavailable === false && platform !== 'darwin' && sb.enabled !== false) loosens.push('let commands run without the sandbox when it can’t start');
  if (sb.allowUnsandboxedCommands === true) loosens.push('let commands run again outside the sandbox');
  const excluded = list(sb.excludedCommands).filter((c) => c.trim() === '*' || RUN_COMMANDS.includes(firstWord(c)));
  if (excluded.length) loosens.push(`run ${excluded.map((c) => `\`${c}\``).join(', ')} outside the sandbox`);
  if (sb.autoAllowBashIfSandboxed === true) loosens.push('let Claude Code run any command in the sandbox, not only TRIF’s');
  if (list(net.allowedDomains).length) loosens.push(`let commands reach ${list(net.allowedDomains).length === 1 ? list(net.allowedDomains)[0] : `${list(net.allowedDomains).length} websites`} on the network`);
  if (list(net.allowUnixSockets).length || net.allowAllUnixSockets === true || net.allowLocalBinding === true) loosens.push('let commands use connections on this computer');
  if (list(fsb.allowWrite).length) loosens.push('let commands write more folders');
  if (list(fsb.allowRead).length) loosens.push('let commands read more folders');

  const allows = list(perms.allow).filter((rule) => {
    const tool = /^([\w-]+)/.exec(rule.trim())?.[1] || '';
    return RUN_TOOLS.includes(tool) || tool.startsWith('mcp__');
  });
  if (allows.length) loosens.push(`allow ${allows.slice(0, 3).map((r) => `\`${r}\``).join(', ')}${allows.length > 3 ? ` and ${allows.length - 3} more` : ''} without asking`);
  if (list(perms.additionalDirectories).length) loosens.push('let Claude Code’s file tools into more folders');
  if (LOOSE_MODES.includes(perms.defaultMode)) loosens.push(`approve Claude Code’s actions by themselves (${perms.defaultMode} mode)`);

  if (s.allowManagedPermissionRulesOnly === true) breaks.push('ignore every permission rule but theirs, TRIF’s too, so Claude Code can’t run `trif` or write this site’s mods');
  if (perms.defaultMode === 'plan') breaks.push('keep Claude Code in plan mode, where it can’t write mods');
  if (fsb.allowManagedReadPathsOnly === true) breaks.push('ignore what TRIF lets commands read, so `trif` can’t run');
  return { loosens, breaks };
}

/**
 * Before a run: {loosens, breaks, sources, errors}, every source's effects together (no duplicates).
 * `errors`: managed files that couldn't be read (Claude Code itself won't start with a broken one).
 */
function check(opts = {}) {
  const { sources: found, errors } = sources(opts);
  const loosens = new Set();
  const breaks = new Set();
  for (const src of found) {
    const e = effects(src.settings, opts);
    for (const x of e.loosens) loosens.add(x);
    for (const x of e.breaks) breaks.add(x);
  }
  return { loosens: [...loosens], breaks: [...breaks], sources: found.map((x) => x.file), errors };
}

module.exports = { check, effects, sources, merge, systemDir, RUN_COMMANDS };

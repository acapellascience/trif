'use strict';
// TRIF's full sandbox (docs/WHOLE-BOX.md), opt-in (Settings: wholeboxsetting.js): the side-panel run's whole agent process, not
// only its shell commands, inside an operating-system sandbox of TRIF's own. Then Claude Code's own file
// tools (Read, Write, Edit, Glob, Grep) are fenced by the system as its commands are, whatever Claude
// Code's settings say (an organization's managed settings can loosen Claude Code's rules, never this).
//
// macOS: Seatbelt, through /usr/bin/sandbox-exec -f <profile> (the same kernel sandbox Claude Code and
// Codex use for their commands). Deny by default; then
//   - read: the system's own folders, the agent's program, node and TRIF's code, the run's working folder
//     (the staged copy), its box, screenshots folder and temporary folders, and the agent's config folder
//     (TRIF's own CLAUDE_CONFIG_DIR, never the user's ~/.claude). Nothing else in the home folder, not
//     the live workspace, not the private folder. (Metadata, stat, anywhere: node looks at every folder
//     on a path. Listing a folder is a read, so not allowed.)
//   - write: the copy's sites/ (other sites' folders in it, and instruction files, denied after), the box,
//     the screenshots folder, the temporary folders, the config folder (its settings files denied).
//   - network: only TCP to the given ports on this computer (TRIF's key proxy, or TRIF's network relay, relay.js
//     below). Seatbelt can't name remote hosts (only "*" or "localhost", and a port), so "only
//     Anthropic" is the proxy's job, and the box makes the proxy the only way out. No DNS (the
//     mDNSResponder socket is closed): names are looked up by the proxy, outside.
//   - no Apple events, no Launch Services, no other mach services but the few listed: `open -a Terminal`
//     or `osascript` would otherwise start a program outside the box.
// A sandboxed process can't apply a second sandbox (sandbox_apply: Operation not permitted, seen on
// macOS 15.7), so Claude Code's own command sandbox must be off inside this one (claude.js wholeBox):
// this box is the commands' fence too.
//
// Windows: not wired here; tests/whole-box/win-probe.js tries claude.exe in an AppContainer on CI.

const fs = require('fs');
const os = require('os');
const path = require('path');


const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const sub = (p) => `(subpath ${q(real(p))})`;
const lit = (p) => `(literal ${q(real(p))})`;
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// What any program needs to start on macOS (dyld, the system libraries, locale, time zones, terminfo).
const SYSTEM_READ = ['/usr', '/System', '/Library/Preferences', '/Library/Apple', '/bin', '/sbin', '/private/etc',
  '/private/var/db/timezone', '/private/var/db/dyld', '/dev', '/opt/homebrew', '/usr/local',
  // An organization's managed settings (claude-managed.js): readable, so its policies still apply in the
  // box. Without these Claude Code says "Managed settings failed to load; policies from the failed source
  // are NOT in effect" and goes on (seen on CI): the box would switch an organization's policy off.
  // (The MDM profile: only Claude Code's own plist, by name: lit() below.)
  '/Library/Application Support/ClaudeCode', '/etc/claude-code'];
const MDM_PLIST = 'com.anthropic.claudecode.plist';
// Mach services: user and group lookups (getpwuid: node's os.userInfo, Claude Code's home folder), and
// the log. Not Launch Services, not Apple events, not the pasteboard, not securityd (see `keychain`).
const MACH = ['com.apple.system.opendirectoryd.libinfo', 'com.apple.system.notification_center', 'com.apple.logd',
  'com.apple.system.logger', 'com.apple.diagnosticd', 'com.apple.trustd', 'com.apple.trustd.agent'];
// The keychain (Claude Code's own login on macOS is a keychain item it reads with /usr/bin/security):
// only with `keychain: true`. Any program in the box could then ask for items whose access list trusts
// /usr/bin/security; see docs/WHOLE-BOX.md.
const KEYCHAIN_MACH = ['com.apple.SecurityServer', 'com.apple.securityd.xpc', 'com.apple.security.agent',
  'com.apple.CoreServices.coreservicesd', 'com.apple.ocspd'];
// Files an agent reads as instructions (stage.js INSTRUCTION_NAME): never written under sites/.
const INSTRUCTION_RE = '(CLAUDE(\\.local)?\\.md|AGENTS(\\.override)?\\.md|GEMINI\\.md|\\.claude|\\.codex|\\.cursorrules|\\.cursor)';

/**
 * The Seatbelt profile (SBPL) for one run.
 *   read, write      folders (real paths are taken)
 *   readOnly         folders inside `write` that stay read-only (other sites' folders in the copy)
 *   sites            the folder (the copy's sites/) where instruction files may not be written
 *   configDir        the agent's own config folder (read and write, its settings files read-only)
 *   ports            TCP ports on this computer the process may connect to
 *   keychain         true: the keychain services and files (Claude Code's own login on macOS)
 *   home             the home folder (for the keychain's files)
 *   tag              put in every refusal's report (boxrefusals.js: the run's error names what was refused)
 */
function macProfile({ read = [], write = [], readOnly = [], sites = '', configDir = '', ports = [], keychain = false, home = os.homedir(), tag = '' } = {}) {
  const msg = tag ? ` (with message ${q(tag)})` : '';
  const L = ['(version 1)', `(deny default${msg})`,
    '(allow process-fork)',
    // A program can be started only where it can be read (exec needs read too).
    '(allow process-exec)',
    '(allow signal (target same-sandbox))',
    '(allow process-info* (target same-sandbox))',
    '(allow sysctl-read)',
    '(allow file-read-metadata)',
    '(allow ipc-posix-sem)',
    '(allow ipc-posix-shm-read-data ipc-posix-shm-read-metadata (ipc-posix-name-regex #"^apple\\.cfprefs\\."))',
    '(allow pseudo-tty)',
    '(allow file-ioctl (regex #"^/dev/(tty|ptmx|ttys[0-9]+|null|zero)$"))',
    `(allow mach-lookup ${MACH.map((m) => `(global-name ${q(m)})`).join(' ')})`,
    `(allow file-read* (literal "/") ${SYSTEM_READ.filter((p) => fs.existsSync(p)).map(sub).join(' ')})`,
    '(allow file-write* (regex #"^/dev/(null|zero|tty|dtracehelper|ttys[0-9]+|ptmx)$"))',
    `(allow file-read* (literal ${q(path.join('/Library/Managed Preferences', MDM_PLIST))}) (literal ${q(path.join('/Library/Managed Preferences', os.userInfo().username, MDM_PLIST))}))`,
  ];
  const reads = [...read, ...write, ...(configDir ? [configDir] : [])].filter(Boolean);
  if (reads.length) L.push(`(allow file-read* ${reads.map(sub).join(' ')})`);
  const writes = [...write, ...(configDir ? [configDir] : [])].filter(Boolean);
  if (writes.length) L.push(`(allow file-write* ${writes.map(sub).join(' ')})`);
  // (later rules win in SBPL: these come after the allows)
  if (readOnly.length) L.push(`(deny file-write* ${readOnly.map(sub).join(' ')}${msg})`);
  if (sites) L.push(`(deny file-write* (regex #"^${reEscape(real(sites))}/(.*/)?${INSTRUCTION_RE}(/.*)?$")${msg})`);
  if (configDir) {
    const c = real(configDir);
    L.push(`(deny file-write* ${['settings.json', 'settings.local.json', 'CLAUDE.md', 'hooks', 'plugins', 'skills', 'agents', 'commands'].map((f) => lit(path.join(c, f)) + ' ' + sub(path.join(c, f))).join(' ')}${msg})`);
  }
  for (const port of ports) L.push(`(allow network-outbound (remote tcp ${q(`localhost:${Number(port)}`)}))`);
  if (keychain) {
    L.push(`(allow mach-lookup ${KEYCHAIN_MACH.map((m) => `(global-name ${q(m)})`).join(' ')})`);
    L.push(`(allow file-read* ${sub(path.join(home, 'Library', 'Keychains'))} ${sub('/Library/Keychains')})`);
    L.push(`(allow file-write* ${sub(path.join(home, 'Library', 'Keychains'))})`);
  }
  return L.join('\n') + '\n';
}

/** Ports on this computer that `env` points the agent at (its key proxy, an HTTPS proxy). */
function localPorts(env = {}) {
  const ports = new Set();
  for (const k of ['ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL', 'HTTPS_PROXY', 'https_proxy']) {
    try {
      const u = new URL(env[k]);
      if (['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) ports.add(Number(u.port || (u.protocol === 'https:' ? 443 : 80)));
    } catch { /* not set, not a URL */ }
  }
  return [...ports];
}

/**
 * What a run's limits (runs.js runLimits, staged) open in the box. Only the copy, never the live
 * workspace (runLimits' `readable` keeps it, for Claude Code's own command sandbox, whose reads are the
 * home folder's denies; here it's left out).
 */
function limitsToBox(limits, { agentBin, configDir, extraRead = [] } = {}) {
  const live = limits.liveWorkspace ? real(limits.liveWorkspace) : '';
  const read = [...(limits.readable || []).filter((p) => !live || real(p) !== live), limits.workspace, limits.box, limits.screenshots,
    ...(agentBin ? [path.dirname(real(agentBin))] : []), ...extraRead,
    // (the live workspace's bin/: the `trif` command on the run's PATH; read only, as everywhere)
    ...(live && fs.existsSync(path.join(live, 'bin')) ? [path.join(live, 'bin')] : [])].filter(Boolean);
  const write = [limits.writable && limits.writable[0], limits.box, limits.screenshots, limits.tmp, limits.agentTmp].filter(Boolean);
  return { read: [...new Set(read)], write: [...new Set(write)], readOnly: limits.readOnly || [], sites: limits.modsDir || '', configDir };
}

/**
 * The command (runs.js: {file, args, env}) wrapped in the box: {file, args, env, profile}. The profile is
 * written to `profileFile` (it names the run's site: not on the command line, which other programs read).
 */
function wrap({ file, args, env = {} }, { limits, configDir, profileFile, keychain = false, platform = process.platform, extraRead = [], ports = [], tag = '' }) {
  if (platform !== 'darwin') throw new Error('TRIF\'s full sandbox is macOS only for now (Windows: tests/whole-box/win-probe.js)');
  const box = limitsToBox(limits, { agentBin: file, configDir, extraRead });
  // (`ports`: more on this computer, an organization's local collector: claude-managed.js orgNetwork)
  const profile = macProfile({ ...box, ports: [...new Set([...localPorts(env), ...ports.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 65536)])], keychain, tag });
  fs.writeFileSync(profileFile, profile, { mode: 0o600 });
  const extraEnv = {
    // Claude Code: no updates from inside a run (the box can't write its versions folder anyway, and the
    // proxy lets no download through), no telemetry or error reports (they'd be refused).
    DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    ...(configDir ? { CLAUDE_CONFIG_DIR: real(configDir) } : {}),
  };
  return { file: '/usr/bin/sandbox-exec', args: ['-f', profileFile, file, ...args], env: { ...env, ...extraEnv }, profile };
}

// ------------------------------------------------------------------ the network relay
//
// Without a key proxy (a token sign-in rather than an API key), Claude Code talks to Anthropic itself.
// The box lets it reach one port on this computer: TRIF's relay (relay.js; HTTPS_PROXY, which Claude Code
// and Codex honor), which tunnels (CONNECT, no TLS termination) only to the hosts listed, port 443, and
// refuses everything else.
const relay = require('./relay');
const ANTHROPIC_HOSTS = relay.ANTHROPIC_HOSTS;

function hostAllowed(hostPort, hosts = ANTHROPIC_HOSTS) {
  const t = relay.parseTarget(hostPort);
  return !!t && t.port === 443 && hosts.includes(t.host);
}

/**
 * startProxy({hosts, allow, connect, lookup}) -> Promise<{port, close, seen}>: relay.start with Anthropic's
 * hosts on 443 (`hosts`: other names on 443; `allow`: [{host, port, local?}], step 5's organization hosts
 * added to them). `connect`/`lookup` (tests): instead of the internet and DNS.
 */
function startProxy({ hosts = ANTHROPIC_HOSTS, allow = [], connect, lookup } = {}) {
  return relay.start({ allow: [...hosts.map((host) => ({ host, port: 443 })), ...allow], ...(connect ? { connect } : {}), ...(lookup ? { lookup } : {}) });
}

module.exports = { macProfile, localPorts, limitsToBox, wrap, startProxy, hostAllowed, ANTHROPIC_HOSTS };

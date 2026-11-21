'use strict';
// What TRIF's full sandbox refused during a run (docs/WHOLE-BOX.md step 3), so a run that fails says what
// the box stopped instead of failing for no visible reason.
//
// Two sources:
//   - Seatbelt's violation reports. Every deny in the run's profile carries `(with message "<tag>")`
//     (wholebox.js macProfile `tag`), which the kernel appends to its report ("Sandbox: claude(123)
//     deny(1) file-read-data /Users/x/.ssh/id_rsa\n<tag>"). `log stream` with a predicate on the tag sees
//     only this run's reports, whichever process in the box made them. `log stream` needs an
//     administrator account (most Macs' own user is one); without it the watcher says why and the run goes
//     on, its errors as before.
//   - TRIF's network relay's refusals (relay.js `seen`: a CONNECT to a host not on its list, a request it
//     couldn't read, an Anthropic host resolving to this computer).
//
// On Windows (step 9b(3)) there are no Seatbelt reports. Two sources there, besides the relay's:
//   - TRIF's own WFP filters' drops (winbox.netEvents: `wfp events`, only drops by TRIF's filters),
//     `fromNetEvents`: the connections refused, with the program. Readable only if Windows lets the person
//     read WFP's net events (CI round 12: see docs/WHOLE-BOX.md); otherwise none, and the run's own lines say it.
//   - The run's own lines (`fromRunOutput`): what the programs in the box were told when Windows refused a
//     file or a connection ("EPERM: operation not permitted, open 'C:\…'", "connect EACCES 1.1.1.1:443",
//     PowerShell's "Access to the path '…' is denied."), from the tools' results and stderr only (never the
//     model's own words). Windows logs no AppContainer file refusals, so this is the only source for files.
//
// Reports are best effort: the kernel doesn't report every refusal (CI, round 5: a Write tool's refused
// write had none, the refusals around it did), and the same operation on the same file is kept once.
//
// What every boxed run is refused along the way (`routine`: CI, round 5, real pinned Claude Code runs that
// worked) is kept in the run's log but left out of a failed run's error, which names only the rest: what
// a run that worked wasn't refused is what may have made this one fail.
//
// Nothing here is secret (paths and host names the box refused), but paths in the home folder are shown
// with ~ and the list is capped.

const { spawn } = require('child_process');
const os = require('os');

const MAX = 50; // refusals kept per run
const SHOWN = 5; // named in the run's error
// (made by every program, refused or not, and never why a run failed)
const NOISE = [/(^|:)\/dev\/dtracehelper\b/];

const unPrivate = (p) => String(p || '').replace(/^\/private(?=\/(tmp|var|etc)(\/|$))/, '');
const under = (p, dir) => !!dir && (p === dir || p.startsWith(dir + '/'));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Refusals every boxed run has (round 5's CI: the real pinned Claude Code, runs that worked), none of them
 * why a run fails. Each: the operation, who (any program when absent) and what, given the run's folders
 * (ctx: homes, the private folder, the workspace, Claude Code's temporary folder). Kept narrow: anything
 * else the box refuses is named in a failed run's error.
 */
const ROUTINE = [
  // (every program using macOS's notification and preference machinery)
  { op: /^ipc-posix-shm-read/, target: () => /^apple\.shm\.notification_center$/ },
  { op: /^file-read/, target: (c) => new RegExp(`^(${c.homes.map(esc).join('|')})/(\\.CFUserTextEncoding|Library/Preferences/\\.GlobalPreferences(_m)?\\.plist|Library/Preferences/ByHost/\\.GlobalPreferences\\.[\\w-]+\\.plist)$`) },
  // (Claude Code and `security`, looking for a keychain login a boxed run doesn't use; analytics; file events)
  { op: /^mach-lookup$/, target: () => /^com\.apple\.(analyticsd|SecurityServer|securityd\.xpc|FSEvents)$/ },
  // (Xcode's `git` shim finding its tools: Claude Code asks git about the folder)
  { op: /^file-read/, target: () => /^(\/Applications\/Xcode[^/]*\.app\/Contents\/Developer|\/Library\/Developer\/CommandLineTools)\/usr\/lib(\/libxcrun\.dylib)?$/ },
  // (Claude Code: sockets in its temporary folder; its plugins and cache folders; ~/.claude, ~/.config)
  { op: /^network-bind/, who: /^claude$/, target: (c) => c.agentTmp && new RegExp(`^${esc(c.agentTmp)}/(cc-socks/\\d+|srt-mux-\\d+-\\d+)\\.sock$`) },
  { op: /^file-write/, who: /^claude$/, target: (c) => c.privateDir && new RegExp(`^${esc(c.privateDir)}/agent-config/claude/plugins$`) },
  { op: /^file-write/, who: /^claude$/, target: (c) => new RegExp(`^(${c.homes.map(esc).join('|')})/(Library/Caches/claude-cli-nodejs|\\.claude|\\.config)$`) },
  // (TRIF's own CLI, `trif`, looking for files it can do without in the box)
  { op: /^file-read/, who: /^node$/, target: (c) => c.privateDir && new RegExp(`^${esc(c.privateDir)}/(config\\.json|helper\\.log)$`) },
  { op: /^file-read/, who: /^node$/, target: (c) => c.workspace && new RegExp(`^${esc(c.workspace)}/preinstalled\\.json$`) },
];

/**
 * The run's folders for `routine` (runs.js): {homes, privateDir, workspace, agentTmp}, /private/… as /….
 * homes: $HOME's and the account's own (macOS's `security` reads the account's, whatever $HOME says).
 */
function accountHome() { try { return os.userInfo().homedir; } catch { return null; } }
function routineContext({ homes = [os.homedir(), accountHome()], privateDir, workspace, agentTmp } = {}) {
  const clean = (p) => (p ? unPrivate(String(p).replace(/\/+$/, '')) : null);
  return { homes: [...new Set(homes.filter(Boolean).map(clean))], privateDir: clean(privateDir), workspace: clean(workspace), agentTmp: clean(agentTmp) };
}

/** Whether a refusal is one every boxed run has (ROUTINE), given routineContext(...). The proxy's never are. */
function routine(r, ctx) {
  if (!r || r.kind === 'proxy' || !ctx) return false;
  const t = unPrivate(r.target);
  return ROUTINE.some((x) => x.op.test(r.op || '') && (!x.who || x.who.test(r.process || '')) && (() => { const re = x.target(ctx); return !!re && re.test(t); })());
}

/** The run's tag in its profile and the reports: letters, digits and dashes only (it goes into SBPL). */
function tagFor(runId) {
  return `TRIF-box-${String(runId).replace(/[^A-Za-z0-9-]/g, '')}`;
}

/** "Sandbox: claude(123) deny(1) file-read-data /x\n<tag>" -> {process, pid, op, target} or null. */
function parseReport(text, tag) {
  const s = String(text || '');
  if (tag && !s.includes(tag)) return null;
  const m = /Sandbox: (.+?)\((\d+)\) deny\(\d+\) (\S+)(?: ([^\n]*))?/.exec(s);
  if (!m) return null;
  return { process: m[1], pid: Number(m[2]), op: m[3], target: (m[4] || '').trim() };
}

const tilde = (p, home) => (home && (p === home || p.startsWith(home + '/') || p.startsWith(home + '\\')) ? `~${p.slice(home.length)}` : p);

/** One refusal in words (drafts: docs/WHOLE-BOX-STRINGS.md). */
function describe(r, { home = os.homedir() } = {}) {
  if (r.kind === 'proxy') {
    if (r.reason === 'unreadable') return 'a request its network relay couldn\'t read';
    return `a connection to ${r.target}${r.reason === 'local address' ? ' (an address on this computer)' : ''}`;
  }
  const t = tilde(r.target || '', home);
  const op = r.op || '';
  let what;
  if (/^file-read/.test(op)) what = `reading ${t}`;
  else if (op === 'file-open') what = `opening ${t}`;
  else if (op === 'network-inbound') what = `a connection from ${t}`;
  else if (/^file-write/.test(op)) what = `writing ${t}`;
  // (Seatbelt names the far end "remote:<ip>:<port>", or "remote:*:<port>" with no address, CI round 6)
  else if (/^network-outbound/.test(op)) {
    const to = t.replace(/^(remote|local):/, '');
    const port = /^\*:(\d+)$/.exec(to);
    what = port ? `a connection to port ${port[1]}` : `a connection to ${to}`;
  }
  else if (/^network-bind/.test(op)) what = `listening on ${t}`;
  else if (op === 'mach-lookup') what = `the system service ${t}`;
  else if (/^process-exec/.test(op)) what = `starting ${t}`;
  else if (/^(signal|process-info)/.test(op)) what = `another program (${op}${t ? ` ${t}` : ''})`;
  else what = `${op}${t ? ` ${t}` : ''}`;
  return r.process ? `${what} (${r.process})` : what;
}

/**
 * The words for a run's error: "TRIF's full sandbox refused: reading ~/x (claude); a connection to
 * example.com:443." (the latest first), or '' with nothing refused.
 */
function summary(refusals, opts = {}) {
  const list = (refusals || []).slice().reverse();
  if (!list.length) return '';
  const shown = list.slice(0, SHOWN).map((r) => describe(r, opts));
  const more = list.length - shown.length;
  return `TRIF's full sandbox refused ${shown.join('; ')}${more > 0 ? `; and ${more} more (in the run's log)` : ''}.`;
}

/**
 * watch(tag) -> {ready: Promise<boolean>, refusals(), unavailable: Promise<string|null>, close()}. `ready`
 * resolves true once `log stream` is reading (or false if it can't: `unavailable` says why), so the run
 * can start after it and none of its reports are missed. `spawnLog` (tests): instead of /usr/bin/log.
 */
function watch(tag, { spawnLog = (args) => spawn('/usr/bin/log', args, { stdio: ['ignore', 'pipe', 'pipe'] }), readyMs = 3000 } = {}) {
  const found = [];
  const keys = new Set();
  let child = null;
  let why = null;
  let setReady;
  const ready = new Promise((r) => { setReady = r; });
  const add = (r) => {
    if (!r || NOISE.some((re) => re.test(r.target))) return;
    const k = `${r.process || ''} ${r.op} ${r.target}`; // (the same file refused to two programs: both)
    if (keys.has(k) || found.length >= MAX) return;
    keys.add(k);
    found.push(r);
  };
  try {
    child = spawnLog(['stream', '--style', 'ndjson', '--predicate', `eventMessage CONTAINS "${tag}"`]);
  } catch (e) { why = e.message; }
  if (!child) { setReady(false); }
  else {
    const timer = setTimeout(() => setReady(true), readyMs); // (no header seen: go on anyway)
    let out = '';
    let err = '';
    const header = (s) => { if (/Filtering the log data/.test(s)) { clearTimeout(timer); setReady(true); } };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      out += d;
      for (let i = out.indexOf('\n'); i >= 0; i = out.indexOf('\n')) {
        const line = out.slice(0, i);
        out = out.slice(i + 1);
        header(line);
        let m = null;
        try { m = JSON.parse(line); } catch { continue; }
        add(parseReport(m && m.eventMessage, tag));
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { err = (err + d).slice(-2000); header(err); });
    child.on('error', (e) => { why = e.message; clearTimeout(timer); setReady(false); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code) why = why || (err.trim().split('\n').pop() || `log exited with code ${code}`);
      setReady(false);
    });
  }
  return {
    ready,
    refusals: () => found.slice(),
    unavailable: () => why,
    add,
    close() { try { child && child.kill('SIGTERM'); } catch { /* gone */ } },
  };
}

/** The relay's refusals (relay.js / wholebox.js startProxy `seen`) as refusals. */
function fromProxy(seen) {
  return (seen || []).filter((x) => !x.allowed).map((x) => ({
    kind: 'proxy', target: String(x.target).slice(0, 200),
    ...(x.reason === 'local address' ? { reason: x.reason } : /^\(/.test(String(x.target)) ? { reason: 'unreadable' } : {}),
  }));
}

// ---- Windows (9b(3))

const baseName = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || null;

/**
 * TRIF's filters' drops (winbox.netEvents().events) -> refusals; `since` (a Date or ms): only the run's own
 * time (the filters are the one container's, so every boxed run's drops are there).
 */
function fromNetEvents(events, { since = null } = {}) {
  const t0 = since == null ? null : +since;
  const out = [];
  for (const e of events || []) {
    if (!e || typeof e !== 'object') continue;
    if (t0 != null && !(Date.parse(e.time) >= t0 - 1000)) continue;
    const who = baseName(e.app);
    const addr = e.remote && String(e.remote).includes(':') ? `[${e.remote}]` : e.remote;
    const proto = Number(e.protocol) === 17 ? ' (UDP)' : '';
    let r;
    if (/^listen/.test(e.layer)) r = { op: 'network-bind', target: `port ${e.localPort}` };
    else if (/^accept/.test(e.layer)) r = { op: 'network-inbound', target: addr ? `${addr}${e.remotePort != null ? `:${e.remotePort}` : ''}` : 'another program' };
    else r = { op: 'network-outbound', target: addr ? `${addr}${e.remotePort != null ? `:${e.remotePort}` : ''}${proto}` : `(an address)${proto}` };
    out.push({ kind: 'net', ...r, ...(who ? { process: who } : {}) });
  }
  return dedupe(out);
}

// What a refused call says, by syscall (Node and Bun word their errors the same way): reading / writing /
// opening (open's mode isn't in the line).
const READS = /^(scandir|lstat|stat|readlink|access|realpath|read|opendir|watch)$/;
const WRITES = /^(mkdir|rename|unlink|rmdir|rm|copyfile|symlink|link|chmod|chown|utime|write|cp|truncate|futime)$/;
const RUN_LINES = [
  // EPERM: operation not permitted, open 'C:\x'  /  EACCES: permission denied, mkdir 'C:\x'
  { re: /\b(EPERM|EACCES): (?:operation not permitted|permission denied), (\w+) '([^'\r\n]{1,400})'/g, make: (m) => ({ op: READS.test(m[2]) ? 'file-read' : WRITES.test(m[2]) ? 'file-write' : 'file-open', target: m[3] }) },
  // connect EACCES 1.1.1.1:443 (Node's words for a refused connect; listen likewise)
  { re: /\bconnect (?:EACCES|EPERM) (\[?[0-9A-Fa-f:.]+\]?:\d{1,5})/g, make: (m) => ({ op: 'network-outbound', target: m[1] }) },
  { re: /\blisten (?:EACCES|EPERM)(?:: permission denied)? (\[?[0-9A-Fa-f:.]+\]?:\d{1,5})/g, make: (m) => ({ op: 'network-bind', target: m[1] }) },
  // spawn C:\x\y.exe EPERM (Node: "spawn <file> <code>"; "spawn EPERM" too, round 9)
  { re: /\bspawn (?:([^\s'"]{1,300}) )?(?:EPERM|EACCES)\b/g, make: (m) => ({ op: 'process-exec', target: m[1] || 'a program' }) },
  // PowerShell / .NET
  { re: /Access to the path '([^'\r\n]{1,400})' is denied/g, make: (m) => ({ op: 'file-open', target: m[1] }) },
];

/** The strings a run's own programs printed: tool results in Claude Code's stream-json, and stderr. */
function runTexts({ stdout = '', stderr = '' } = {}) {
  const texts = [];
  const pull = (c) => {
    if (typeof c === 'string') texts.push(c);
    else if (Array.isArray(c)) c.forEach(pull);
    else if (c && typeof c === 'object' && typeof c.text === 'string') texts.push(c.text);
  };
  for (const line of String(stdout).split(/\r?\n/)) {
    let m = null;
    try { m = JSON.parse(line); } catch { continue; }
    if (!m || m.type !== 'user' || !m.message || !Array.isArray(m.message.content)) continue;
    for (const c of m.message.content) if (c && c.type === 'tool_result') pull(c.content);
    if (m.tool_use_result && typeof m.tool_use_result === 'string') texts.push(m.tool_use_result);
  }
  if (stderr) texts.push(String(stderr));
  return texts;
}

/** The refusals named in a run's own lines (Windows: Windows logs none for files) -> refusals. */
function fromRunOutput(out) {
  const found = [];
  for (const text of runTexts(out)) {
    for (const { re, make } of RUN_LINES) {
      re.lastIndex = 0;
      for (let m = re.exec(text); m; m = re.exec(text)) found.push({ kind: 'own', ...make(m) });
    }
  }
  return dedupe(found);
}

function dedupe(list) {
  const keys = new Set();
  const out = [];
  for (const r of list) {
    const k = `${r.process || ''} ${r.op} ${String(r.target).toLowerCase()}`;
    if (keys.has(k) || out.length >= MAX) continue;
    keys.add(k);
    out.push(r);
  }
  return out;
}

module.exports = { fromNetEvents, fromRunOutput, runTexts, dedupe, tagFor, parseReport, describe, summary, watch, fromProxy, routine, routineContext, ROUTINE, NOISE, MAX };

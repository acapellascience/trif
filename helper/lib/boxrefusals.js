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
//   - The allowlist proxy's refusals (wholebox.js startProxy `seen`: a CONNECT to a host not on its list).
//
// Nothing here is secret (paths and host names the box refused), but paths in the home folder are shown
// with ~ and the list is capped.

const { spawn } = require('child_process');
const os = require('os');

const MAX = 50; // refusals kept per run
const SHOWN = 5; // named in the run's error
// (made by every program, refused or not, and never why a run failed)
const NOISE = [/(^|:)\/dev\/dtracehelper\b/];

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

const tilde = (p, home) => (home && (p === home || p.startsWith(home + '/')) ? `~${p.slice(home.length)}` : p);

/** One refusal in words (drafts: docs/WHOLE-BOX-STRINGS.md). */
function describe(r, { home = os.homedir() } = {}) {
  if (r.kind === 'proxy') return `a connection to ${r.target}`;
  const t = tilde(r.target || '', home);
  const op = r.op || '';
  let what;
  if (/^file-read/.test(op)) what = `reading ${t}`;
  else if (/^file-write/.test(op)) what = `writing ${t}`;
  else if (/^network-outbound/.test(op)) what = `a connection to ${t.replace(/^\*:/, '')}`;
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
function watch(tag, { spawnLog = (args) => spawn('/usr/bin/log', args, { stdio: ['ignore', 'pipe', 'pipe'] }), readyMs = 1500 } = {}) {
  const found = [];
  const keys = new Set();
  let child = null;
  let why = null;
  let setReady;
  const ready = new Promise((r) => { setReady = r; });
  const add = (r) => {
    if (!r || NOISE.some((re) => re.test(r.target))) return;
    const k = `${r.op} ${r.target}`;
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

/** The proxy's refusals (startProxy `seen`) as refusals. */
function fromProxy(seen) {
  return (seen || []).filter((x) => !x.allowed).map((x) => ({ kind: 'proxy', target: String(x.target).slice(0, 200) }));
}

module.exports = { tagFor, parseReport, describe, summary, watch, fromProxy, NOISE, MAX };

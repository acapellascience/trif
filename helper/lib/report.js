'use strict';
// "Report a problem": a plain-text report of what's installed and what's going wrong, for the user to
// read and send. The side panel opens the report form (package.json bugs.url, timsrobot.com/report) with it
// filled in; `trif report` prints it (--open: the form). Nothing is sent from here. Personal details are scrubbed: the home folder and user name, email addresses, query
// strings, and anything that looks like a token.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const P = require('./paths');

const LOG_TAIL_BYTES = 256 * 1024;
const MAX_LOG_LINES = 15;

/** The address reports go to: package.json's bugs.email, or null when this build has none. */
function reportEmail(root = P.REPO_ROOT) {
  try {
    const bugs = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).bugs;
    const email = bugs && typeof bugs === 'object' ? bugs.email : null;
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  } catch { return null; }
}

/** The problem report form: package.json's bugs.url when it's an https page, else null. */
function reportUrl(root = P.REPO_ROOT) {
  try {
    const bugs = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).bugs;
    const url = bugs && typeof bugs === 'object' ? bugs.url : null;
    return typeof url === 'string' && /^https:\/\/[^\s#]+$/.test(url) ? url : null;
  } catch { return null; }
}

/** The form's address with a report filled in: after the #, which browsers never send to a server. */
function reportLink(url, text, site) {
  const params = new URLSearchParams({ r: text });
  if (site) params.set('s', site);
  return `${url}#${params.toString()}`;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Remove personal details from report text. */
function scrub(text, { home = os.homedir(), user = os.userInfo().username } = {}) {
  let t = String(text);
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>');
  if (home && home.length > 1) t = t.replace(new RegExp(escapeRe(home), 'g'), '~');
  t = t.replace(/\/(Users|home)\/[^/\s"']+/g, '/$1/<user>');
  if (user && user.length > 2) t = t.replace(new RegExp(`\\b${escapeRe(user)}\\b`, 'gi'), '<user>');
  t = t.replace(/(https?:\/\/[^\s?#"']+)[?#][^\s"']*/g, '$1?…');
  t = t.replace(/\b[A-Za-z0-9_-]{32,}\b/g, (s) => (/^[a-p]{32}$/.test(s) ? s : '<redacted>')); // keep extension IDs
  return t;
}

const LOG_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const MOD_ID = /\b[a-z0-9.-]+\.[a-z]{2,}\/[\w-]+\b|\ball-sites\/[\w-]+\b/gi;

/**
 * The last warnings and errors in the helper log (the last 3 days), with repeats folded together: lines
 * that differ only in a mod id or a number count as one ("×15, e.g. x.com/detox-timeline").
 */
function logProblems(logFile, { max = MAX_LOG_LINES, now = Date.now() } = {}) {
  let text = '';
  try {
    const fd = fs.openSync(logFile, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const start = Math.max(0, size - LOG_TAIL_BYTES);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      text = buf.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch { return []; }
  const groups = new Map(); // folded message -> { time, message, count, example }
  for (const line of text.split('\n')) {
    const m = /^(\S+) \[\d+\] (WARN|ERROR) (.*)$/.exec(line);
    if (!m) continue;
    const t = Date.parse(m[1]);
    if (!(t > now - LOG_WINDOW_MS)) continue;
    const message = `${m[2]} ${m[3]}`.slice(0, 300);
    const key = message.replace(MOD_ID, '<mod>').replace(/\b([a-z]*)\d+\b/gi, '$1N');
    const g = groups.get(key) || { message, count: 0, example: (message.match(MOD_ID) || [])[0] || null };
    g.count++;
    g.time = m[1];
    groups.delete(key); // newest last
    groups.set(key, g);
  }
  return [...groups.entries()].slice(-max).map(([key, g]) => (g.count > 1
    ? `${g.time.slice(0, 16).replace('T', ' ')} ${key} (×${g.count}${g.example ? `, e.g. ${g.example}` : ''})`
    : `${g.time.slice(0, 16).replace('T', ' ')} ${g.message}`));
}

function systemLine() {
  let osName = `${os.type()} ${os.release()}`;
  if (process.platform === 'darwin') {
    const r = spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) osName = `macOS ${r.stdout.trim()}`;
  }
  return `${osName} (${os.arch()}), Node ${process.version}`;
}

/**
 * The report text. info (all optional): { description, site, siteOn, browser, extensionVersion, helper:
 * {role, connectedFor}, agents: [{id, available, version, loggedIn}], update: summary from update.js,
 * mods: [{id, enabled, registered, error}], doctor: {checks}, logFile }.
 */
function buildReport(info = {}, scrubOpts) {
  const lines = [];
  const row = (k, v) => lines.push(`${k.padEnd(12)}${v}`);
  lines.push('TRIF problem report');
  lines.push('');
  if (info.description && info.description.trim()) {
    lines.push('What happened');
    lines.push(info.description.trim());
    lines.push('');
  }
  row('TRIF', `${P.VERSION} (${P.isGitCheckout() ? 'git checkout' : 'installed copy'})`);
  if (info.browser) row('Browser', `${info.browser}${info.extensionVersion ? ` (extension ${info.extensionVersion})` : ''}`);
  row('System', systemLine());
  if (info.agents) {
    row('Agents', info.agents.map((a) => (a.available
      ? `${a.id}${a.version ? ` ${a.version}` : ''}${a.loggedIn === false ? ' (not logged in)' : a.loggedIn ? ' (logged in)' : ''}`
      : `${a.id} not found`)).join(', ') || 'none');
  }
  if (info.helper) row('Helper', `${info.helper.role || 'unknown'}${info.helper.connectedFor ? `, connected ${info.helper.connectedFor}` : ''}`);
  if (info.update) {
    const u = info.update;
    row('Updates', u.available ? `${u.latest} available` : u.error ? `couldn't check (${u.error})` : u.latest ? 'up to date' : 'not checked yet');
  }
  if (info.site) row('Site', `${info.site}, TRIF ${info.siteOn ? 'on' : 'off'}`);
  if (Array.isArray(info.mods) && info.mods.length) {
    lines.push('');
    lines.push(`Mods for ${info.site || 'this site'}`);
    for (const m of info.mods) {
      const st = m.enabled === false ? 'off' : m.registered ? 'on, running' : 'on, not running';
      lines.push(`  ${m.id}: ${st}${m.error ? ` (error: ${String(m.error).slice(0, 200)})` : ''}`);
    }
  }
  if (info.doctor && Array.isArray(info.doctor.checks)) {
    const c = info.doctor.checks;
    const count = (s) => c.filter((x) => x.status === s).length;
    lines.push('');
    const n = (k, word) => `${count(k)} ${word}${count(k) === 1 ? '' : 's'}`;
    lines.push(`Doctor      ${count('ok')} ok, ${n('warn', 'warning')}, ${n('fail', 'problem')}`);
    for (const x of c.filter((y) => y.status === 'warn' || y.status === 'fail')) lines.push(`  ${x.status}  ${x.title}`);
  }
  const problems = info.logFile ? logProblems(info.logFile) : [];
  if (problems.length) {
    lines.push('');
    lines.push('Recent warnings and errors (helper log)');
    for (const l of problems) lines.push(`  ${l}`);
  }
  return scrub(lines.join('\n'), scrubOpts);
}

module.exports = { reportEmail, reportUrl, reportLink, scrub, logProblems, buildReport };

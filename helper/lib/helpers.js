'use strict';
// Every running helper: one per connected browser (or Chrome profile). Each listens on its own socket,
// <home>/helper-<pid>.sock, and the first one also serves <home>/helper.sock, the CLI's default. Agent
// runs get their helper's own socket as TRIF_SOCK, so a run started from Firefox's sidebar works on
// Firefox's tabs even while Chrome's helper owns helper.sock. `--browser` picks one from a terminal.

const fs = require('fs');
const path = require('path');
const { request, HelperError } = require('./client');

const SOCK_RE = /^helper-(\d+)\.sock$/;

function ownSock(home, pid = process.pid) {
  return path.join(home, `helper-${pid}.sock`);
}

/** [{sock, pid}] for every helper-<pid>.sock in home (live or not). */
function helperSockets(home) {
  let names = [];
  try { names = fs.readdirSync(home); } catch { return []; }
  return names.map((n) => [n, SOCK_RE.exec(n)]).filter(([, m]) => m)
    .map(([n, m]) => ({ sock: path.join(home, n), pid: Number(m[1]) }))
    .sort((a, b) => a.pid - b.pid);
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** Remove sockets left behind by helpers that died without cleaning up. Returns the removed paths. */
function removeStaleSockets(home, alive = pidAlive) {
  const removed = [];
  for (const h of helperSockets(home)) {
    if (h.pid === process.pid || alive(h.pid)) continue;
    try { fs.unlinkSync(h.sock); removed.push(h.sock); } catch { /* already gone */ }
  }
  return removed;
}

/** [{sock, pid, info}] for the helpers that answer a ping (info is the ping result). */
async function listHelpers(home, timeoutMs = 1500) {
  const found = await Promise.all(helperSockets(home).map(async (h) => {
    try { return { ...h, info: await request(h.sock, 'ping', {}, timeoutMs) }; } catch { return null; }
  }));
  return found.filter(Boolean);
}

function browserName(info) {
  return (info && info.extension && info.extension.browser) || 'Chrome';
}

function describeHelper(h) {
  const e = h.info.extension;
  const what = e ? `${browserName(h.info)} ${e.chrome}` : 'a browser that hasn\'t said hello yet';
  return `${what} (pid ${h.pid}${h.info.role === 'primary' ? ', the default' : ''})`;
}

/**
 * The socket for `--browser <choice>`: a browser name ("firefox", "chrome") or a helper's pid. Throws a
 * HelperError naming the connected browsers when nothing (or more than one helper) matches.
 */
async function pickHelper(home, choice) {
  const want = String(choice).trim().toLowerCase();
  const helpers = await listHelpers(home);
  const connected = helpers.length ? `Connected: ${helpers.map(describeHelper).join(', ')}.` : 'No browser is connected.';
  const matches = /^\d+$/.test(want)
    ? helpers.filter((h) => h.pid === Number(want))
    : helpers.filter((h) => h.info.extension && browserName(h.info).toLowerCase() === want);
  if (matches.length === 1) return matches[0].sock;
  // With nothing connected at all the CLI's usual "helper isn't running" message (exit 2) fits; otherwise
  // say which browsers are there.
  if (!helpers.length) throw new HelperError(`no browser is connected (--browser ${choice})`, 'no-helper');
  if (!matches.length) throw new HelperError(`no connected browser matches --browser ${choice}. ${connected}`, 'command');
  throw new HelperError(`more than one ${browserName(matches[0].info)} is connected (separate profiles); pick one with --browser <pid>. ${connected}`, 'command');
}

/**
 * The newest modification time of the helper's code under `dir` (.js files, recursively), for a helper to
 * notice that its own code changed on disk since it started (see host.js checkCodeChanged).
 */
function codeStamp(dir) {
  let newest = 0;
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) { try { newest = Math.max(newest, fs.statSync(p).mtimeMs); } catch { /* vanished */ } }
    }
  };
  walk(dir);
  return newest;
}

module.exports = { ownSock, helperSockets, removeStaleSockets, listHelpers, pickHelper, describeHelper, browserName, pidAlive, codeStamp };

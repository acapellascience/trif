'use strict';
// A run started for a paired phone (docs/PHONE-LINK.md section 6): what runs.js needs for its `remote` mark.
// The run itself is an ordinary one (Runs.start → _launch: the same sandbox, staging and token limits). What
// is different is decided here, by the helper, from the page's address alone:
//   - its site is always the phone twin of the address's host, `phone~<host>`: nothing the phone sends names a
//     site, a folder or a file;
//   - the phone's copy of the page and its screenshot are files in the run's screenshots folder, data for the
//     agent to read;
//   - it has no tab on this computer: of the helper's commands it may use only the ones in REMOTE_COMMANDS,
//     none of which reaches the extension;
//   - it never goes on without TRIF's sandbox (runs.js _withoutSandbox).

const fs = require('fs');
const path = require('path');
const { PHONE_PREFIX, scopeOf, cleanSplits } = require('../scope');
const { ownTwin } = require('../stage');

const URL_MAX = 4096;
const PROMPT_MAX = 64 * 1024; // characters
const PAGE_MAX = 2 * 1024 * 1024; // bytes of UTF-8
const SHOT_MAX = 5 * 1024 * 1024; // bytes (as base64 it still fits one 8 MB message, section 4)
// A host name as a site folder may be named: labels of letters, digits and hyphens with dots between, so no
// "..", no slash, no "~", no port, no IPv6 literal, nothing empty.
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

// The helper's own commands a remote run may use (host.js onClientLine answers each itself, limited to the
// run's site). Everything else would go to the extension, to a tab: refused. (Step 7 adds the commands behind
// `trif phone`.)
const REMOTE_COMMANDS = new Set(['ping', 'mods', 'mod.delete', 'mod.restore', 'mod.code', 'mod.diff']);
// Of those, the ones that change a mod: only one in the run's own phone twin (stage.js ownTwin). The rule for
// a side-panel chat (trash.js checkScope) takes a phone twin's scope to cover its site's desktop folder too.
const CHANGES_A_MOD = new Map([['mod.delete', 'delete'], ['mod.restore', 'restore']]);

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/** The page's address as a remote run may have it: {url (no login, no fragment), host}. Throws `bad-url`. */
function remoteAddress(url) {
  if (typeof url !== 'string' || !url || url.length > URL_MAX) throw fail('bad-url', 'the phone sent no page address');
  let u;
  try { u = new URL(url); } catch { throw fail('bad-url', 'the phone\'s page address isn\'t an address'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw fail('bad-url', 'the phone\'s page isn\'t a web page (http or https)');
  const host = u.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  if (host.length > 253 || !HOST_RE.test(host)) throw fail('bad-url', 'the phone\'s page address has no site name TRIF can make a folder for');
  u.username = '';
  u.password = '';
  u.hash = '';
  return { url: u.href, host };
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function imageKind(buf) {
  if (buf.length > JPEG.length && buf.subarray(0, JPEG.length).equals(JPEG)) return 'jpg';
  if (buf.length > PNG.length && buf.subarray(0, PNG.length).equals(PNG)) return 'png';
  return null;
}

/**
 * What Runs.startRemote starts a run with. `own`: the helper's own word, {phone: {id, name}, splits (the
 * sensitive sites of their own, sitecombos.js splitsOf), sessionId, agent, model}. `msg`: what the phone sent,
 * {url, prompt, page (text), shot (a Buffer, JPEG or PNG; optional), width}. Nothing in `msg` chooses the
 * site: it is made from the address's host. Returns {args (for Runs.start), remote (the run's mark)}.
 */
function remoteStart(own = {}, msg = {}) {
  const phone = own.phone && typeof own.phone === 'object' ? own.phone : {};
  if (typeof phone.id !== 'string' || !/^[0-9a-f]{16}$/.test(phone.id)) throw fail('bad-request', 'a remote run needs the paired phone it is for');
  const { url, host } = remoteAddress(msg.url);
  if (typeof msg.prompt !== 'string' || !msg.prompt.trim()) throw fail('bad-request', 'missing prompt');
  if (msg.prompt.length > PROMPT_MAX) throw fail('too-big', 'the message is too long');
  if (typeof msg.page !== 'string') throw fail('bad-request', 'the phone sent no copy of the page');
  if (Buffer.byteLength(msg.page, 'utf8') > PAGE_MAX) throw fail('too-big', `the phone's copy of the page is over ${PAGE_MAX / 1024 / 1024} MB`);
  let shot = null;
  let shotKind = null;
  if (msg.shot !== undefined && msg.shot !== null) {
    if (!Buffer.isBuffer(msg.shot) || !msg.shot.length) throw fail('bad-request', 'the phone\'s screenshot isn\'t an image');
    if (msg.shot.length > SHOT_MAX) throw fail('too-big', `the phone's screenshot is over ${SHOT_MAX / 1024 / 1024} MB`);
    shotKind = imageKind(msg.shot);
    if (!shotKind) throw fail('bad-request', 'the phone\'s screenshot isn\'t a JPEG or a PNG');
    shot = msg.shot;
  }
  const splits = cleanSplits(own.splits);
  const width = Number.isInteger(msg.width) && msg.width >= 200 && msg.width <= 2000 ? msg.width : null;
  const args = {
    site: PHONE_PREFIX + host,
    scope: PHONE_PREFIX + scopeOf(host, splits),
    splits,
    url,
    prompt: msg.prompt,
    ...(own.sessionId ? { sessionId: own.sessionId } : {}),
    ...(own.agent ? { agent: own.agent } : {}),
    ...(own.model ? { model: own.model } : {}),
  };
  const remote = { phone: { id: phone.id, name: typeof phone.name === 'string' ? phone.name.slice(0, 80) : '' }, width, page: msg.page, shot, shotKind, files: null };
  return { args, remote };
}

/**
 * The phone's copy of the page and its screenshot, written into the run's screenshots folder (as checked by
 * runs.js screenshotsFolder: its real path, links in it removed) under names of the run's own, made fresh
 * (never through a link, never over another run's). Sets run.remote.files {page, shot} (as the agent names
 * them, in $TRIF_RUN_SCREENSHOTS) and lets go of the text and the image.
 */
function writeRemoteFiles(run) {
  const r = run.remote;
  const put = (name, data) => {
    fs.writeFileSync(path.join(run.screenshotsReal, name), data, { flag: 'wx', mode: 0o600 });
    return path.join(run.screenshots, name);
  };
  const files = { page: put(`phone-page-${run.id}.txt`, r.page), shot: null };
  if (r.shot) files.shot = put(`phone-screenshot-${run.id}.${r.shotKind}`, r.shot);
  r.files = files;
  r.page = null;
  r.shot = null;
}

/** They go when the run ends: a page as the user's phone showed it isn't kept longer than the run needs it. */
function removeRemoteFiles(run) {
  const files = run.remote && run.remote.files;
  if (!files || !run.screenshotsReal) return;
  for (const f of [files.page, files.shot]) {
    if (f) { try { fs.unlinkSync(path.join(run.screenshotsReal, path.basename(f))); } catch { /* gone */ } }
  }
}

/** What the agent's context says of the run (agents/index.js contextText `remote`). */
function remoteContext(run) {
  const r = run.remote;
  return { page: r.files ? r.files.page : null, shot: r.files ? r.files.shot : null, width: r.width };
}

/**
 * The refusal for a request from a remote run, or null when it may go on: the helper's own commands only
 * (REMOTE_COMMANDS), so nothing of a phone run's reaches the extension or a tab on this computer.
 */
function remoteRefusal(run, cmd, args = {}) {
  if (!run || !run.remote) return null;
  if (typeof cmd === 'string' && CHANGES_A_MOD.has(cmd)) {
    const id = args && typeof args.id === 'string' ? args.id : '';
    if (ownTwin(id.split('/')[0], run.scope, run.splits || [])) return null;
    return `this run is for the user's phone: it can only ${CHANGES_A_MOD.get(cmd)} phone mods of its own site (sites/${run.scope}/), not ${id.slice(0, 120) || 'that'}`;
  }
  if (typeof cmd === 'string' && REMOTE_COMMANDS.has(cmd)) return null;
  return `this run is for the user's phone: the page is open there, not in a tab on this computer, so "${String(cmd).slice(0, 40)}" isn't available in it. To reach the phone's page: \`trif phone page [selector]\`, \`trif phone try <mod>\`, \`trif phone screenshot\``;
}

module.exports = { remoteStart, remoteAddress, writeRemoteFiles, removeRemoteFiles, remoteContext, remoteRefusal, REMOTE_COMMANDS, PAGE_MAX, SHOT_MAX, PROMPT_MAX };

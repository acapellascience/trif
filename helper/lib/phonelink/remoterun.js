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

// The commands behind `trif phone` (cli.js) and the phone's tool each one asks for (docs/PHONE-LINK.md section 4,
// `tool.request`). They are a remote run's alone, answered by the phone it is for, never by the extension.
const REMOTE_TOOLS = new Map([['remote.page', 'read_page'], ['remote.try', 'try_mod'], ['remote.screenshot', 'screenshot']]);
// The helper's own commands a remote run may use (host.js onClientLine answers each itself, limited to the
// run's site). Everything else would go to the extension, to a tab: refused.
const REMOTE_COMMANDS = new Set(['ping', 'mods', 'mod.delete', 'mod.restore', 'mod.code', 'mod.diff', ...REMOTE_TOOLS.keys()]);
const DRAFT_MAX = 1024 * 1024; // (a draft's code, bytes: one mod, as remote.js sends one in a result)
const SELECTOR_MAX = 500;
const TOOL_SHOTS = 30; // (screenshots the phone sent back that one run keeps; the oldest goes)
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

/**
 * The phone twin a page address's run works in: {url, host, site, scope}, from the address and the helper's
 * own list of sensitive sites of their own (`splits`). Throws `bad-url`. (remote.js asks before it starts a
 * run: which twin a conversation to go on with must be of.)
 */
function remoteScope(url, splits) {
  const a = remoteAddress(url);
  return { ...a, site: PHONE_PREFIX + a.host, scope: PHONE_PREFIX + scopeOf(a.host, cleanSplits(splits)) };
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
  const splits = cleanSplits(own.splits);
  const { url, site, scope } = remoteScope(msg.url, splits);
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
  const width = Number.isInteger(msg.width) && msg.width >= 200 && msg.width <= 2000 ? msg.width : null;
  const args = {
    site,
    scope,
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
  for (const f of [files.page, files.shot, ...(files.tools || [])]) {
    if (f) { try { fs.unlinkSync(path.join(run.screenshotsReal, path.basename(f))); } catch { /* gone */ } }
  }
}

/**
 * A screenshot the phone sent back for `trif phone try` or `trif phone screenshot` (a Buffer), written into the
 * run's screenshots folder as writeRemoteFiles writes the first one. Returns the file as the agent names it, or
 * null when it isn't a JPEG or a PNG. They go with the run (removeRemoteFiles), and before that when a run has
 * more than TOOL_SHOTS of them.
 */
function writeToolShot(run, buf) {
  const r = run.remote;
  const kind = Buffer.isBuffer(buf) && buf.length <= SHOT_MAX ? imageKind(buf) : null;
  if (!kind || !r || !r.files || !run.screenshotsReal) return null;
  r.shots = (r.shots || 0) + 1;
  const name = `phone-now-${run.id}-${r.shots}.${kind}`;
  fs.writeFileSync(path.join(run.screenshotsReal, name), buf, { flag: 'wx', mode: 0o600 });
  const tools = r.files.tools || (r.files.tools = []);
  tools.push(path.join(run.screenshots, name));
  while (tools.length > TOOL_SHOTS) { try { fs.unlinkSync(path.join(run.screenshotsReal, path.basename(tools.shift()))); } catch { /* gone */ } }
  return tools[tools.length - 1];
}

/**
 * The draft `trif phone try <mod>` sends to the phone: a mod of the run's own phone twin, read from the run's
 * working copy (stage.js: what the agent has just saved, before any of it is in the mods folder). `id`:
 * `<mod>` (the run's own twin) or `<twin>/<mod>`, with or without `sites/` before and `.js` after. Nothing
 * else of it is a path: the folder must be the run's own twin (stage.js ownTwin), the name a file's name, and
 * neither is read through a link. → {id, code}. Throws `bad-request`, `no-mod`, `too-big`.
 */
function readDraft(run, id) {
  const said = (typeof id === 'string' ? id : '').trim().replace(/\\/g, '/').replace(/^(.*\/)?sites\//, '').replace(/\.js$/, '');
  const parts = said.split('/');
  const folder = parts.length === 2 ? parts[0] : run.scope;
  const name = parts[parts.length - 1];
  if (!said || parts.length > 2 || !/^[^._/\\][^/\\]*$/.test(name) || name.length > 200) throw fail('bad-request', 'usage: trif phone try <mod> (a mod of this run\'s phone twin, e.g. `trif phone try bottom-bar`)');
  if (!ownTwin(folder, run.scope, run.splits || [])) throw fail('bad-request', `this run can try only phone mods of its own site (sites/${run.scope}/), not one in sites/${folder.slice(0, 120)}/`);
  if (!run.stage || !run.stage.sites) throw fail('no-mod', 'this run has no working folder (any more)');
  const dir = path.join(run.stage.sites, folder);
  const missing = () => fail('no-mod', `there is no sites/${folder}/${name}.js in your working folder: save the draft there first (\`trif new ${folder} ${name}\`)`);
  let code;
  try {
    if (!fs.lstatSync(dir).isDirectory()) throw missing();
    const fd = fs.openSync(path.join(dir, `${name}.js`), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile()) throw missing();
      if (st.size > DRAFT_MAX) throw fail('too-big', `sites/${folder}/${name}.js is over ${DRAFT_MAX / 1024 / 1024} MB: too big to send to the phone`);
      code = fs.readFileSync(fd, 'utf8');
    } finally { fs.closeSync(fd); }
  } catch (e) {
    if (e.code === 'no-mod' || e.code === 'too-big') throw e;
    throw missing();
  }
  return { id: `${folder}/${name}`, code };
}

/**
 * What a `trif phone` command asks the phone for: {tool, input}, as `tool.request` carries them. Throws
 * `bad-request` (and readDraft's) for what the agent got wrong.
 */
function toolRequest(run, cmd, args = {}) {
  const tool = REMOTE_TOOLS.get(cmd);
  if (tool === 'read_page') {
    const selector = typeof args.selector === 'string' ? args.selector.trim() : '';
    if (selector.length > SELECTOR_MAX) throw fail('bad-request', `the selector is over ${SELECTOR_MAX} characters`);
    const limit = Number.isInteger(args.limit) && args.limit > 0 ? Math.min(args.limit, 200) : null;
    return { tool, input: { ...(selector ? { selector } : {}), ...(limit ? { limit } : {}) } };
  }
  if (tool === 'try_mod') {
    const draft = readDraft(run, args.id);
    return { tool, input: { id: draft.id, code: draft.code } };
  }
  if (tool === 'screenshot') return { tool, input: {} };
  throw fail('bad-request', 'not a phone command');
}

/**
 * A `trif phone` command as the helper answers it (host.js onClientLine): null for any other command; else a
 * promise of the phone's answer, {text, file (its screenshot, in the run's screenshots folder) | null, error}.
 * `tool`: (run, cmd, args) → that promise, remote.js `Remote.tool`, in the helper that owns the phone link.
 * Outside a remote run, and in a helper without the link, it is refused in words the agent can act on.
 */
function remoteCommand(run, cmd, args, tool) {
  if (typeof cmd !== 'string' || !REMOTE_TOOLS.has(cmd)) return null;
  if (!run || !run.remote) return Promise.reject(fail('not-remote', '`trif phone` reaches the page on the user\'s phone, in a run they started from the phone: this isn\'t one. Here the page is in a tab on this computer (trif text, trif screenshot, trif verify)'));
  if (typeof tool !== 'function') return Promise.reject(fail('away', AWAY));
  return new Promise((resolve) => { resolve(tool(run, cmd, args && typeof args === 'object' ? args : {})); });
}
// (what an agent is told when the phone can't be asked: finish without it, as its context says)
const AWAY = 'the phone isn\'t connected right now (the user put it down, or closed TRIF there), so it can\'t show or try anything: finish from what you have, and say in your reply what you couldn\'t try. The user sees the mod when they\'re back';

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

module.exports = {
  remoteStart, remoteAddress, remoteScope, writeRemoteFiles, removeRemoteFiles, remoteContext, remoteRefusal, remoteCommand, toolRequest, readDraft,
  writeToolShot, imageKind, REMOTE_COMMANDS, REMOTE_TOOLS, AWAY, PAGE_MAX, SHOT_MAX, PROMPT_MAX, DRAFT_MAX, TOOL_SHOTS,
};

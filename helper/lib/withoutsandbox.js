'use strict';
// Running an agent without TRIF's sandbox: the user's consent, per agent.
//
// An organization's managed settings can replace the limits TRIF gives an agent's runs (codex.js
// sandboxOverridden: Codex's "requirements" refuse TRIF's permission profile; claude.js preflight:
// Claude Code's managed settings turn its sandbox off or allow more). Without consent such a run is
// stopped (runs.js). With it, the run goes on under the organization's settings, and the panel marks the
// chat "no TRIF sandbox".
//
// The consent is in config.json `withoutSandbox` ({<agent id>: {at}}), in the private folder (paths.js
// privateDir), which runs can neither read nor write: their sandboxes deny it (runs.js runLimits). It is
// only ever set by a click in the side panel: host.js takes `agent.withoutSandbox` from the extension's
// native messaging connection alone (never from the socket, a run's mailbox or `trif`), and the
// background only from the panel page. A run that went on without TRIF's sandbox may be able to write
// the private folder (that's up to the organization's settings), so when it ends, any consent added
// meanwhile that this helper didn't write is taken out again (guard).

const { readConfig } = require('./paths');

const KEY = 'withoutSandbox';
// The agents whose runs can be told apart this way (an id outside this list is never stored).
const AGENTS = ['claude', 'codex', 'codex-oss'];

// What this helper wrote: agent id -> the `at` it stored (guard leaves those alone).
const written = new Map();

/** {<agent id>: {at}} for the agents allowed to run without TRIF's sandbox. */
function consents(home) {
  const raw = readConfig(home).config[KEY];
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const id of AGENTS) {
    const v = raw[id];
    if (v && typeof v === 'object' && typeof v.at === 'string' && v.at) out[id] = { at: v.at };
  }
  return out;
}

function allowed(home, agent) {
  return Object.prototype.hasOwnProperty.call(consents(home), String(agent));
}

/** Store (on) or remove the consent for `agent`. Returns consents(home). */
function setAllowed(home, agent, on, { setConfigKey = require('./update').setConfigKey } = {}) {
  const id = String(agent || '');
  if (!AGENTS.includes(id)) throw new Error(`unknown agent "${id.slice(0, 40)}"`);
  const next = consents(home);
  if (on) {
    next[id] = { at: new Date().toISOString() };
    written.set(id, next[id].at);
  } else {
    delete next[id];
    written.delete(id);
  }
  setConfigKey(home, KEY, Object.keys(next).length ? next : undefined);
  return next;
}

/**
 * After a run that went on without TRIF's sandbox: take out every consent that wasn't there before it
 * (`before`, consents() then) and that this helper didn't store meanwhile. Returns the ids taken out.
 */
function guard(home, before, { logger, setConfigKey = require('./update').setConfigKey } = {}) {
  let now;
  try { now = consents(home); } catch { return []; }
  const added = Object.keys(now).filter((id) => !(before && before[id]) && written.get(id) !== now[id].at);
  if (!added.length) return [];
  for (const id of added) delete now[id];
  setConfigKey(home, KEY, Object.keys(now).length ? now : undefined);
  if (logger) logger.warn(`consent to run ${added.join(', ')} without TRIF's sandbox appeared during a run without it, not from the side panel: removed`);
  return added;
}

// An organization's settings can also be stricter than TRIF's (seen with Codex's CodexStandard: `trif`
// couldn't write the run's mailbox, and writes to sites/ were refused, "the workspace is read-only").
// Then a run without TRIF's sandbox can't do its work: runs.js ends it with the adapter's
// orgBlockedMessage. 'helper' (`trif` can't reach the helper: client.js boxRequest, or the socket,
// refused), 'write' (a write to the mods folder refused), or null.
const NO_HELPER = /can[’']t reach the helper through \S+: (EPERM|EACCES|EROFS)\b|helper not running \((EPERM|EACCES)\b/;
const READ_ONLY = /workspace is read-only|read-only sandbox/i;
const REFUSED = /Read-only file system|Operation not permitted|Permission denied|\bEROFS\b|\bEPERM\b|\bEACCES\b/i;
function blockedText(text) {
  const t = String(text || '');
  if (!t) return null;
  if (NO_HELPER.test(t)) return 'helper';
  if (READ_ONLY.test(t)) return 'write';
  if (/(^|[\s/'"`])sites\//.test(t) && REFUSED.test(t)) return 'write';
  return null;
}

module.exports = { KEY, AGENTS, consents, allowed, setAllowed, guard, blockedText };

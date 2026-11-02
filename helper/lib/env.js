'use strict';
// TRIF's environment variables: TRIF_<NAME>. Before 0.2.0 (when TRIF was called WebMods) they were
// WEBMODS_<NAME>, and those are still read when the TRIF_ one isn't set: an older helper's updater runs the
// new version's setup with WEBMODS_HOME and WEBMODS_INSTALL_LOCK, an older helper gives its agent runs
// WEBMODS_RUN_TOKEN (and its Safari bridge gives its hosts WEBMODS_SAFARI_BRIDGE), and people may have
// WEBMODS_HOME in their shell profile. What TRIF sets is always TRIF_<NAME>.

const PREFIX = 'TRIF_';
const LEGACY_PREFIX = 'WEBMODS_';

/** The variable's value: TRIF_<name>, else WEBMODS_<name>, else undefined. */
function envVar(name, env = process.env) {
  const v = env[PREFIX + name];
  return v !== undefined ? v : env[LEGACY_PREFIX + name];
}

/** The name TRIF sets: TRIF_<name>. */
function envName(name) {
  return PREFIX + name;
}

module.exports = { envVar, envName, PREFIX, LEGACY_PREFIX };

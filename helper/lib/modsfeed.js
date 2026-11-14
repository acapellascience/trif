'use strict';
// The mods feed: new versions of the mods TRIF ships (Tim's mods, preinstalled.js) between releases, so a
// fixed shipped mod doesn't wait for a whole TRIF release.
//
// A second signed feed beside the TRIF one (update.js), made the same way: updates/mods.json in the repo, read
// from raw.githubusercontent.com, next to mods.json.sig, an Ed25519 signature of its exact bytes by the release
// key (release-key.js). Written by `node scripts/release.js mods-feed`, and by every release (empty then:
// the release ships the mods itself) and `refresh-feed`, so the two feeds never disagree.
//
//   { "kind": "trif-mods", "signed": "2026-11-20T18:04:11.000Z", "release": "0.3.0",
//     "commit": "<the 40-hex commit the files are at>",
//     "mods": { "x.com/detox-timeline": { "version": "5", "sha256": "…", "size": 64434, "minTrif": "0.3.0" } } }
//
// - `kind`: the same key signs latest.json, so each feed says which it is; a latest.json and its signature
//   served as mods.json (or the other way round) is refused.
// - The files come from the repo at `commit`: raw.githubusercontent.com/<repo>/<commit>/examples/sites/<id>.js.
//   The URL is made here, never read from the feed, so a feed can't send TRIF anywhere else; a commit's
//   files never change (a GitHub release's assets can be replaced, and a release just for mods would also
//   become the repo's "latest", which the Firefox add-on's download link relies on: update.js FIREFOX_XPI).
//   Every file is checked against the signed sha256 and size before anything uses it, and must be a shipped
//   mod (`@source webmods`) whose @version is the feed's.
// - It expires like latest.json, 8 weeks after `signed` (update.js FEED_MAX_AGE_MS, which explains why):
//   an old signed feed served again could hide a fix (a mod that breaks a site, or sends what it shouldn't).
//   `release.js refresh-feed` signs both feeds again.
// - Only the ids this TRIF ships (PREINSTALLED, never a RETIRED one) can be updated; any other id is ignored.
//   The feed never adds a mod: a new shipped mod comes with a release, which lists it, lets each user choose
//   its site, and says what it is (setup page, Settings). A feed that could add one could put new code on a
//   site the user never chose Tim's mods for.
// - An entry is used only when it's newer than the version this TRIF has (examples/sites) and this TRIF is
//   at least its `minTrif` (the TRIF it was made and tested with; the mod may use what that version added).
//
// Delivery is the shipped-mod update preinstalled.js already does (updateShippedMods): an unchanged copy is
// replaced (and starts off, "updated"), a changed one gets "Use the new version / Keep mine / Merge". Unless
// the user turned automatic updates on (config.json "autoUpdate", as for TRIF's own updates), an unchanged
// copy is offered too, not replaced. Held mods (held.js): a version from this feed is judged against the
// version a release shipped (the one in examples/sites), not against itself, so one that can do more than
// that waits for the user's OK.
//
// Files (the helper's, outside sites/; runs can read them, not write them):
//   <home>/.mods-feed/mods.json, mods.json.sig   the last feed that verified, as it came
//   <home>/.mods-feed/sites/<site>/<mod>.js        its files for this TRIF, each checked
//   <home>/.mods-feed/delivered.json               {id: [sha1 of every version this feed brought]}
//   <home>/.mods-feed/state.json                   {checkedAt, error, signedAt, available, skipped}
// It's checked with TRIF's own update check (host.js checkForUpdate; `trif update`), at most every 20 hours,
// and not at all with config.json "checkForUpdates": false.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('./paths');
const update = require('./update');
const { parseHeader, sha1, isShippedSource } = require('./mods');

const KIND = 'trif-mods';
const DIR = '.mods-feed';
const FEED_MAX = 256 * 1024;
const FILE_MAX = 8 * 1024 * 1024; // (X-Flyer is 2.3 MB)
const SEMVER = /^\d+\.\d+\.\d+$/;
const MOD_VERSION = /^\d+(\.\d+)*$/;
const ID = /^[a-z0-9-]+(\.[a-z0-9-]+)+\/[a-z0-9][a-z0-9-]*$/;
const COMMIT = /^[0-9a-f]{40}$/;

class ModsFeedError extends Error {}

const dir = (home) => path.join(home, DIR);
const feedFile = (home) => path.join(dir(home), 'mods.json');
const cachedFile = (home, id) => path.join(dir(home), 'sites', `${id}.js`);
const deliveredFile = (home) => path.join(dir(home), 'delivered.json');
const stateFile = (home) => path.join(dir(home), 'state.json');

function readJson(file) {
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}
function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// A shipped mod's @version, dotted numbers: whether a is newer than b ('10' > '9', '2.1' > '2').
function newer(a, b) {
  if (!MOD_VERSION.test(String(a ?? ''))) return false;
  if (!MOD_VERSION.test(String(b ?? ''))) return true; // (nothing, or not a number, is older than any version)
  const x = String(a).split('.').map(Number);
  const y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

/**
 * Where the mods feed is: config.json "modsFeed" (a URL to mods.json), else beside latest.json (update.js
 * feedUrl: config.json "updateFeed", else the GitHub repo's), or null.
 */
function modsFeedUrl(ws, pkg = update.packageJson()) {
  if (typeof ws.config?.modsFeed === 'string' && ws.config.modsFeed.trim()) return ws.config.modsFeed.trim();
  const latest = update.feedUrl(ws, pkg);
  return latest && /\/latest\.json$/.test(latest) ? latest.replace(/latest\.json$/, 'mods.json') : null;
}

/**
 * Where a feed's file is: the repo at the feed's commit (raw.githubusercontent.com/<owner>/<repo>/<ref>/updates/
 * mods.json -> .../<commit>/examples/sites/<id>.js), or, for a mirror (config.json), beside its updates/ folder.
 */
function fileUrl(feedUrl, commit, id) {
  const m = /^https:\/\/raw\.githubusercontent\.com\/([\w.-]+)\/([\w.-]+)\/[^/]+\/updates\/mods\.json$/.exec(feedUrl);
  if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${commit}/examples/sites/${id}.js`;
  return new URL(`../examples/sites/${id}.js`, feedUrl).href;
}

/**
 * The feed, if `sig` (base64) is the release key's signature of `bytes`, it's a mods feed, and it isn't too
 * old (`maxAge`; Infinity for the copy already checked when it came); throws ModsFeedError otherwise.
 * Returns {signedAt, release, commit, mods: {id: {version, sha256, size, minTrif}}, invalid: [ids]}.
 */
function verifyModsFeed(bytes, sig, publicKey, { now = Date.now(), maxAge = update.FEED_MAX_AGE_MS } = {}) {
  if (!publicKey) throw new ModsFeedError("this build has no release key, so it can't verify the mods feed");
  let ok = false;
  try { ok = crypto.verify(null, bytes, publicKey, Buffer.from(String(sig).trim(), 'base64')); } catch { ok = false; }
  if (!ok) throw new ModsFeedError('the mods feed is not signed by the TRIF release key; ignoring it');
  let feed;
  try { feed = JSON.parse(bytes.toString('utf8')); } catch (e) { throw new ModsFeedError(`the mods feed isn't valid JSON: ${e.message}`); }
  if (!feed || feed.kind !== KIND) throw new ModsFeedError(`the mods feed isn't one (no "kind": "${KIND}"); ignoring it`);
  if (!COMMIT.test(String(feed.commit))) throw new ModsFeedError('the mods feed has no valid commit');
  const signedAt = typeof feed.signed === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(feed.signed) ? Date.parse(feed.signed) : NaN;
  if (!Number.isFinite(signedAt)) throw new ModsFeedError('the mods feed has no date, so it may be an old copy that hides a newer version; not using it');
  if (now - signedAt > maxAge) {
    const weeks = Math.round(maxAge / (7 * 24 * 60 * 60 * 1000));
    throw new ModsFeedError(`the mods feed is from ${new Date(signedAt).toISOString().slice(0, 10)}, more than ${weeks} weeks ago, so it may be an old copy that hides a newer version; not using it`);
  }
  const mods = {};
  const invalid = [];
  const list = feed.mods && typeof feed.mods === 'object' && !Array.isArray(feed.mods) ? feed.mods : {};
  for (const [id, e] of Object.entries(list)) {
    const good = ID.test(id) && e && MOD_VERSION.test(String(e.version)) && /^[0-9a-f]{64}$/.test(String(e.sha256))
      && Number.isInteger(e.size) && e.size > 0 && e.size <= FILE_MAX && SEMVER.test(String(e.minTrif));
    if (good) mods[id] = { version: String(e.version), sha256: e.sha256, size: e.size, minTrif: e.minTrif };
    else invalid.push(id);
  }
  return { signedAt, release: SEMVER.test(String(feed.release)) ? feed.release : null, commit: feed.commit, mods, invalid };
}

const atLeast = (v, min) => { try { return update.compareVersions(v, min) >= 0; } catch { return false; } };

/**
 * The feed's entries this TRIF can use: {take: [{id, version, sha256, size, minTrif}], skipped: [{id, why}]}.
 * `trif`: the installed TRIF's version; `bundled(id)`: the version of the mod this TRIF has, or null.
 */
function select(feed, { list, retired, trif, bundled }) {
  const take = [];
  const skipped = [];
  const ids = new Set(list.map((m) => m.id));
  const gone = new Set(retired.map((r) => r.id));
  for (const [id, e] of Object.entries(feed.mods)) {
    let why = null;
    if (gone.has(id)) why = 'retired: TRIF no longer ships it';
    else if (!ids.has(id)) why = "not one of the mods this TRIF ships (the feed doesn't add mods)";
    else if (!atLeast(trif, e.minTrif)) why = `needs TRIF ${e.minTrif} (this is ${trif})`;
    else {
      const have = bundled(id);
      if (have === undefined) why = 'this TRIF has no copy of it';
      else if (!newer(e.version, have)) why = `not newer than the version this TRIF has (${have ?? 'none'})`;
    }
    if (why) skipped.push({ id, version: e.version, why });
    else take.push({ id, ...e });
  }
  return { take, skipped };
}

// The version of each shipped mod in this TRIF's examples (undefined: none there, or not a shipped mod).
function bundledVersions(examplesDir) {
  return (id) => {
    let code;
    try { code = fs.readFileSync(path.join(examplesDir, `${id}.js`), 'utf8'); } catch { return undefined; }
    const h = parseHeader(code);
    return isShippedSource(h.source) ? h.version || null : undefined;
  };
}

/** Why a downloaded file isn't the feed's version of `id`, or null. */
function fileProblem(buf, e) {
  if (buf.length !== e.size) return `the download is ${buf.length} bytes, not the ${e.size} the feed says`;
  if (sha256(buf) !== e.sha256) return "the download's checksum doesn't match the signed feed";
  const h = parseHeader(buf.toString('utf8'));
  if (!isShippedSource(h.source)) return "it isn't marked as a mod TRIF ships (@source webmods)";
  if (String(h.version || '') !== e.version) return `its @version is ${h.version || 'missing'}, not the feed's ${e.version}`;
  return null;
}

function defaults(opts) {
  const pre = require('./preinstalled');
  return {
    list: opts.list || pre.PREINSTALLED,
    retired: opts.retired || pre.RETIRED,
    examplesDir: opts.examplesDir || pre.examplesDir(),
    trif: opts.trif || update.packageJson(opts.root || P.REPO_ROOT).version || P.VERSION,
    publicKey: opts.publicKey === undefined ? require('./release-key') : opts.publicKey,
  };
}

/** {id: [sha1]}: every version this feed brought (held.js judges those against the released version). */
function delivered(home) {
  const out = {};
  for (const [id, v] of Object.entries(readJson(deliveredFile(home)))) if (Array.isArray(v)) out[id] = v.filter((h) => typeof h === 'string');
  return out;
}

function addDelivered(home, id, hash) {
  const all = delivered(home);
  const list = all[id] || [];
  if (list.includes(hash)) return;
  all[id] = [...list, hash].slice(-100);
  writeAtomic(deliveredFile(home), JSON.stringify(all, null, 2) + '\n');
}

function readState(home) { return readJson(stateFile(home)); }

/**
 * The feed's versions TRIF can use now: {id: {code (Buffer), hash (sha1), version}}, from the copy kept
 * when it was checked: its signature checked again, each file against it, and the entries chosen again for
 * this TRIF (a TRIF update may have brought the same version or a newer one). {} when there's none.
 */
function cached(home, opts = {}) {
  const o = defaults(opts);
  let bytes, sig;
  try { bytes = fs.readFileSync(feedFile(home)); sig = fs.readFileSync(`${feedFile(home)}.sig`, 'utf8'); } catch { return {}; }
  let feed;
  try { feed = verifyModsFeed(bytes, sig, o.publicKey, { maxAge: Infinity }); } catch { return {}; }
  const out = {};
  for (const e of select(feed, { list: o.list, retired: o.retired, trif: o.trif, bundled: bundledVersions(o.examplesDir) }).take) {
    let buf;
    try { buf = fs.readFileSync(cachedFile(home, e.id)); } catch { continue; }
    if (fileProblem(buf, e)) continue;
    out[e.id] = { code: buf, hash: sha1(buf), version: e.version };
  }
  return out;
}

/**
 * Check the mods feed (at most every 20 hours unless `force`) and keep the versions this TRIF can use in
 * <home>/.mods-feed. Never throws: errors land in the result's `error`. Returns the state: {checkedAt, error,
 * signedAt, available: [{id, version}], skipped: [{id, version, why}]}. opts.fetch replaces update.fetchUrl
 * (tests); opts.now, the time it's judged at.
 */
async function check(ws, { force = false, now = Date.now(), fetch = update.fetchUrl, ...opts } = {}) {
  const o = defaults(opts);
  const s = readState(ws.home);
  const url = modsFeedUrl(ws, update.packageJson(opts.root || P.REPO_ROOT));
  if (!url) return { ...s, error: null, available: [] };
  if (!update.checksOn(ws) && !force) return s;
  if (!force && s.checkedAt && now - s.checkedAt < update.CHECK_EVERY_MS && !s.error) return s;
  const next = { checkedAt: now, error: null, signedAt: null, available: [], skipped: [] };
  try {
    let bytes, sig;
    try {
      bytes = await fetch(url, { maxBytes: FEED_MAX });
    } catch (e) {
      // No feed there (none published yet): nothing to offer, not an error. What was kept goes.
      if (!/answered HTTP 404/.test(e.message)) throw e;
      fs.rmSync(path.join(dir(ws.home), 'sites'), { recursive: true, force: true });
      for (const f of [feedFile(ws.home), `${feedFile(ws.home)}.sig`]) fs.rmSync(f, { force: true });
      bytes = null;
    }
    if (bytes) {
      try { sig = await fetch(`${url}.sig`, { maxBytes: 1024 }); } catch (e) { throw new ModsFeedError(`the mods feed has no signature (${e.message}); ignoring it`); }
      const feed = verifyModsFeed(bytes, sig.toString('utf8'), o.publicKey, { now });
      next.signedAt = feed.signedAt;
      const { take, skipped } = select(feed, { list: o.list, retired: o.retired, trif: o.trif, bundled: bundledVersions(o.examplesDir) });
      next.skipped = [...skipped, ...feed.invalid.map((id) => ({ id, why: "the feed's entry for it isn't valid" }))];
      const keep = new Set();
      for (const e of take) {
        const dest = cachedFile(ws.home, e.id);
        let have = null;
        try { have = fs.readFileSync(dest); } catch { /* not yet */ }
        if (!have || fileProblem(have, e)) {
          let buf;
          try { buf = await fetch(fileUrl(url, feed.commit, e.id), { maxBytes: e.size, timeoutMs: 60000 }); } catch (x) { next.skipped.push({ id: e.id, version: e.version, why: x.message }); continue; }
          const why = fileProblem(buf, e);
          if (why) { next.skipped.push({ id: e.id, version: e.version, why: `${why}; not using it` }); continue; }
          writeAtomic(dest, buf);
          have = buf;
        }
        addDelivered(ws.home, e.id, sha1(have));
        keep.add(e.id);
        next.available.push({ id: e.id, version: e.version });
      }
      // The feed as it came (cached() checks it again), and only its files for this TRIF.
      writeAtomic(feedFile(ws.home), bytes);
      writeAtomic(`${feedFile(ws.home)}.sig`, sig);
      for (const m of [...o.list.map((x) => x.id), ...Object.keys(feed.mods)]) {
        if (!keep.has(m) && ID.test(m)) fs.rmSync(cachedFile(ws.home, m), { force: true });
      }
    }
  } catch (e) {
    // (what was kept stays as it was: a feed that doesn't verify changes nothing)
    next.error = e.message;
  }
  try { writeAtomic(stateFile(ws.home), JSON.stringify(next, null, 2) + '\n'); } catch { /* checked again next time */ }
  return next;
}

/**
 * Bring the feed's versions to the user's copies: preinstalled.js updateShippedMods for the mods it has a
 * version of (unchanged copies replaced only with automatic updates on, else offered), then, as setup does,
 * retireShippedMods. Returns updateShippedMods' {updated, waiting}.
 */
function apply(ws, opts = {}) {
  const pre = require('./preinstalled');
  const o = defaults(opts);
  const feed = cached(ws.home, opts);
  const ids = Object.keys(feed);
  if (!ids.length) return { updated: [], waiting: [] };
  const r = pre.updateShippedMods(ws.home, ws.modsDir, o.examplesDir, o.list.filter((m) => ids.includes(m.id)),
    { feed, autoFeed: opts.autoFeed === undefined ? update.autoUpdateOn(ws) : opts.autoFeed });
  if (r.updated.length) { try { pre.retireShippedMods(ws, o.examplesDir); } catch { /* setup does it again */ } }
  return r;
}

/**
 * The version a release shipped of mod `id`, when `code` (a shipped mod's base, <home>/.shipped) is one only
 * this feed brought: held.js judges the mod against that one, so a version from the feed that can do more
 * than the released one waits for the user's OK. Else `code`, as it is. null when there's no released
 * version to go by (the mod is then judged as one TRIF doesn't ship).
 */
function releasedBaseline(home, id, code, examplesDir = require('./preinstalled').examplesDir()) {
  const mine = delivered(home)[id];
  if (!mine || !mine.length) return code;
  const hash = sha1(Buffer.isBuffer(code) ? code : Buffer.from(String(code), 'utf8'));
  if (!mine.includes(hash)) return code;
  let released;
  try { released = fs.readFileSync(path.join(examplesDir, `${id}.js`), 'utf8'); } catch { return null; }
  if (sha1(Buffer.from(released, 'utf8')) === hash) return code; // (a release ships it now)
  const history = require('./preinstalled').loadHistory(examplesDir);
  if (Array.isArray(history[id]) && history[id].includes(hash)) return code;
  return isShippedSource(parseHeader(released).source) ? released : null;
}

module.exports = {
  KIND, DIR, FILE_MAX, ModsFeedError, newer, modsFeedUrl, fileUrl, verifyModsFeed, select, cached, check, apply, delivered,
  releasedBaseline, readState, cachedFile, feedFile,
};

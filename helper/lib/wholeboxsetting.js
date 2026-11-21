'use strict';
// Settings' "Run chats in TRIF's full sandbox" (docs/WHOLE-BOX-PROGRESS.md step 1b; words: WHOLE-BOX-STRINGS.md).
// Off by default. config.json "wholeBox": true turns it on (the side panel's switch alone: host.js
// PANEL_COMMANDS; config.json is in the private folder, out of every run's reach). Turning it on downloads
// TRIF's pinned Claude Code (claudepin.js) in the background, its progress sent to the panel; so does a
// helper starting with it on and the copy missing. A run while the copy isn't there stops and says so
// (runs.js; the offer of the older protection instead: step 4). Turning it off keeps the copy (a later
// helper's prunePinned removes older pins only), and a download under way finishes.
// macOS only for now (Windows: step 9b): elsewhere `available` is false and the panel shows no switch.
//
// The sign-in (step 6b): Claude Code's own login is out of the box's reach, so boxed runs use a saved
// Anthropic API key (its key proxy, as now) or the token `claude setup-token` gives (claudetoken.js, in the
// keyring). `status().signedIn`: either is there and the token hasn't been refused (null: not checked
// yet). A run whose token Claude Code refused (expired, revoked) says so (`noteRefused`) until the next
// sign-in. Sign out (`signOut`, the panel's alone) removes the token.

const KEY = 'wholeBox';
const isOn = (ws) => ws?.config?.[KEY] === true;

/**
 * @param {object} o
 * @param {() => object} o.getWorkspace  the helper's workspace (its .config is read and updated)
 * @param {(home: string, key: string, value: any) => void} o.setConfigKey  update.js setConfigKey
 * @param {(status: object) => void} [o.onChange]  the status, sent to the panel (at most every `everyMs` while downloading)
 */
function createWholeBoxSetting({ getWorkspace, setConfigKey, onChange = () => {}, log = () => {}, cp = require('./claudepin'),
  platform = process.platform, arch = process.arch, env = process.env, everyMs = 500,
  ct = require('./claudetoken'), hasKey = (o) => require('./agentkeys').hasAgentKey('claude', o) } = {}) {
  let fetch = null; // { got, total } while this helper downloads it
  let error = null; // the last download's failure, until the next try
  let lastSent = 0;
  let timer = null;
  let signIn = { known: false, token: false, key: false, refused: false, error: null };

  const available = () => { try { return platform === 'darwin' && !!cp.platformKey(platform, arch, cp.pinsInUse(env)); } catch { return false; } };
  const ws = () => getWorkspace();

  function status() {
    const w = ws();
    const on = available() && isOn(w);
    let version = null;
    try { version = cp.pinsInUse(env).version; } catch { /* no pin file */ }
    const have = available() ? cp.installedPinned(w.home, { platform, arch, env }) : null;
    const pin = have ? 'ready' : fetch ? 'downloading' : error ? 'failed' : 'missing';
    const signedIn = signIn.known ? (signIn.token && !signIn.refused) || signIn.key : null;
    return { available: available(), on, pin, version, ...(fetch && !have ? { got: fetch.got, total: fetch.total } : {}), ...(pin === 'failed' ? { error } : {}),
      signedIn, token: signIn.token, key: signIn.key, ...(signIn.refused ? { refused: true } : {}), ...(signIn.error ? { signInError: signIn.error } : {}) };
  }

  /** Look again at what a boxed run would sign in with (never reads the token itself). Resolves the status. */
  async function refreshSignIn() {
    if (!available()) return status();
    let t = { stored: false, error: null };
    let k = { stored: false };
    try { t = await ct.hasToken({ env }); } catch (e) { t = { stored: false, error: e.message }; }
    try { k = await hasKey({ config: ws().config || {}, env }); } catch { /* none */ }
    signIn = { known: true, token: !!t.stored, key: !!k.stored, refused: signIn.refused && !!t.stored, error: t.error || null };
    send(true);
    return status();
  }

  function send(force) {
    const now = Date.now();
    clearTimeout(timer);
    timer = null;
    if (!force && now - lastSent < everyMs) { timer = setTimeout(() => send(true), everyMs - (now - lastSent)); timer.unref?.(); return; }
    lastSent = now;
    try { onChange(status()); } catch (e) { log('warn', `the full sandbox setting: couldn't send its state: ${e.message}`); }
  }

  /** Download TRIF's copy if it's missing (one download at a time; claudepin shares it). Resolves the status. */
  function download() {
    const w = ws();
    if (!available() || cp.installedPinned(w.home, { platform, arch, env })) return Promise.resolve(status());
    if (fetch) return fetch.promise;
    error = null;
    fetch = { got: 0, total: 0, promise: null };
    log('info', 'downloading TRIF\'s copy of Claude Code (TRIF\'s full sandbox)');
    const f = fetch;
    f.promise = cp.ensurePinned(w.home, { platform, arch, env, onProgress: (got, total) => { f.got = got; f.total = total; send(false); } }).then((r) => {
      log('info', `TRIF's copy of Claude Code ${r.version} is ready${r.fetched ? ' (downloaded)' : ''}`);
      try { const gone = cp.prunePinned(w.home, { platform, arch, env }); if (gone.length) log('info', `removed older copies of Claude Code: ${gone.join(', ')}`); } catch { /* next time */ }
    }, (e) => {
      error = String(e?.message || e);
      log('warn', `couldn't download TRIF's copy of Claude Code: ${error}`);
    }).then(() => { fetch = null; send(true); return status(); });
    send(true);
    return f.promise;
  }

  return {
    status,
    /** The helper started (or the panel connected): with the setting on and the copy missing, fetch it. */
    start() { if (available() && isOn(ws())) download(); send(true); refreshSignIn().catch(() => {}); return status(); },
    /** The panel's switch. Resolves the status at once (the download goes on in the background). */
    set(on) {
      if (on && !available()) throw new Error('TRIF\'s full sandbox isn\'t available on this computer yet');
      const w = ws();
      setConfigKey(w.home, KEY, on ? true : undefined);
      w.config = { ...(w.config || {}), [KEY]: on ? true : undefined };
      log('info', `TRIF's full sandbox for chats ${on ? 'on' : 'off'} (Settings in the side panel)`);
      if (on) { download(); refreshSignIn().catch(() => {}); }
      send(true);
      return status();
    },
    refreshSignIn,
    /** A sign-in (logins.js mode "token") finished: a new token, so not refused. */
    signedIn() { signIn = { ...signIn, refused: false }; return refreshSignIn(); },
    /** A boxed run's token was refused by Claude Code (runs.js done.error.refused). */
    noteRefused() { if (!signIn.refused) { signIn = { ...signIn, refused: true }; log('info', 'TRIF\'s full sandbox: Claude Code refused its sign-in'); send(true); } return status(); },
    /** Settings' Sign out: the token leaves the keyring. Resolves the status. */
    async signOut() {
      const r = await ct.removeToken({ env });
      log('info', `TRIF's full sandbox: signed out${r.removed ? '' : ' (there was no sign-in)'}`);
      signIn = { ...signIn, refused: false };
      return refreshSignIn();
    },
    /** "Try again" after a failed download. */
    retry() { if (isOn(ws())) download(); send(true); return status(); },
    download,
  };
}

module.exports = { KEY, isOn, createWholeBoxSetting };

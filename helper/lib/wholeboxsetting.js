'use strict';
// Settings' "Run chats in TRIF's full sandbox" (docs/WHOLE-BOX-PROGRESS.md step 1b; words: WHOLE-BOX-STRINGS.md).
// Off by default. config.json "wholeBox": true turns it on (the side panel's switch alone: host.js
// PANEL_COMMANDS; config.json is in the private folder, out of every run's reach). Turning it on downloads
// TRIF's pinned Claude Code (claudepin.js) in the background, its progress sent to the panel; so does a
// helper starting with it on and the copy missing. A run while the copy isn't there stops and says so
// (runs.js; the offer of the older protection instead: step 4). Turning it off keeps the copy (a later
// helper's prunePinned removes older pins only), and a download under way finishes.
// macOS only for now (Windows: step 9b): elsewhere `available` is false and the panel shows no switch.

const KEY = 'wholeBox';
const isOn = (ws) => ws?.config?.[KEY] === true;

/**
 * @param {object} o
 * @param {() => object} o.getWorkspace  the helper's workspace (its .config is read and updated)
 * @param {(home: string, key: string, value: any) => void} o.setConfigKey  update.js setConfigKey
 * @param {(status: object) => void} [o.onChange]  the status, sent to the panel (at most every `everyMs` while downloading)
 */
function createWholeBoxSetting({ getWorkspace, setConfigKey, onChange = () => {}, log = () => {}, cp = require('./claudepin'),
  platform = process.platform, arch = process.arch, env = process.env, everyMs = 500 } = {}) {
  let fetch = null; // { got, total } while this helper downloads it
  let error = null; // the last download's failure, until the next try
  let lastSent = 0;
  let timer = null;

  const available = () => { try { return platform === 'darwin' && !!cp.platformKey(platform, arch, cp.pinsInUse(env)); } catch { return false; } };
  const ws = () => getWorkspace();

  function status() {
    const w = ws();
    const on = available() && isOn(w);
    let version = null;
    try { version = cp.pinsInUse(env).version; } catch { /* no pin file */ }
    const have = available() ? cp.installedPinned(w.home, { platform, arch, env }) : null;
    const pin = have ? 'ready' : fetch ? 'downloading' : error ? 'failed' : 'missing';
    return { available: available(), on, pin, version, ...(fetch && !have ? { got: fetch.got, total: fetch.total } : {}), ...(pin === 'failed' ? { error } : {}) };
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
    start() { if (available() && isOn(ws())) download(); send(true); return status(); },
    /** The panel's switch. Resolves the status at once (the download goes on in the background). */
    set(on) {
      if (on && !available()) throw new Error('TRIF\'s full sandbox isn\'t available on this computer yet');
      const w = ws();
      setConfigKey(w.home, KEY, on ? true : undefined);
      w.config = { ...(w.config || {}), [KEY]: on ? true : undefined };
      log('info', `TRIF's full sandbox for chats ${on ? 'on' : 'off'} (Settings in the side panel)`);
      if (on) download();
      send(true);
      return status();
    },
    /** "Try again" after a failed download. */
    retry() { if (isOn(ws())) download(); send(true); return status(); },
    download,
  };
}

module.exports = { KEY, isOn, createWholeBoxSetting };
